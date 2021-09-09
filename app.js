require('dotenv').config()

const express = require('express')
const app = express()
const cors = require('cors')
const { v4: uuid } = require('uuid')
const { Client, Environment } = require('square')
const axios = require('axios')
const { PDFDocument } = require('pdf-lib')
const emailjs = require('emailjs-com')
const logdna = require('@logdna/logger')

const port = 8080
const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

const carrierCode = process.env.NODE_ENV === 'LOCAL' || process.env.NODE_ENV === 'TEST' ? 'se-637975' : 'se-748344'
const serviceCodes = ["usps_parcel_select", "usps_first_class_mail", "usps_priority_mail"]

const logOptions = {
  app: process.env.APP_NAME,
  level: 'debug'
}
const logger = process.env.NODE_ENV === 'LOCAL' || process.env.NODE_ENV === 'TEST' ? console : logdna.createLogger(process.env.LOGDNA_KEY, logOptions)

const squareClient = new Client({
  environment: process.env.NODE_ENV === 'LOCAL' || process.env.NODE_ENV === 'TEST' ? Environment.Sandbox : Environment.Production,
  accessToken: process.env.SQUARE_ACCESS_TOKEN
})

app.use(express.json())
app.use(cors({
  origin: "*",
  credentials: true
}))

emailjs.init(process.env.EMAILJS_ID)

const MongoClient = require('mongodb')
const { EMAILJS_ERROR, ORDERS_API_ERROR, SHIPPING_LABEL_ERROR, SERVER_ERROR, PAYMENTS_API_ERROR, CUSTOMERS_API_ERROR, SOLD_OUT, SHIPPING_RATE_ERROR, NOT_FOUND, TOO_MANY, SHIPENGINE_ERROR, CARDS_API_ERROR, BAD_REQUEST } = require('./constants')

const url = `mongodb://${process.env.MONGO_URL}`

const printJSON = (jsonObject) => {
  return JSON.stringify(jsonObject, (key, value) => 
    typeof value === 'bigint'
      ? Number.parseInt(value)
      : value, 2)
}

const completeOrder = async (order) => {
  const { ordersApi, paymentsApi } = squareClient
  logger.info(`Completing order ${order.id}${order.customerId ? ` for customer with id ${order.customerId}` : ''}`)
  let lineItems = []
  for(const lineItem of order.lineItems) {
    if(lineItem.uid !== 'shipping') {
      lineItems.push({
        id: lineItem.uid,
        name: lineItem.name,
        quantity: Number.parseFloat(lineItem.quantity),
        price: Number.parseFloat(lineItem.basePriceMoney.amount.toString()) / 100,
        totalPrice: Number.parseFloat(lineItem.totalMoney.amount.toString()) / 100
      })
    }
  }

  let completedOrder = {
    id: order.id,
    customerId: order.customerId,
    paymentIds: [],
    totalCost: Number.parseFloat(order.totalMoney.amount.toString()) / 100,
    items: lineItems
  }

  if(order.metadata && order.metadata.rate_id && !order.metadata.shippingLabelId && !order.metadata.shipmentId) {
    logger.info(`Creating shipping label for order ${order.id}`)
    const body = {
      validate_address: "validate_and_clean"
    }

    const headers = {
      "Host": "api.shipengine.com",
      "API-Key": process.env.SHIPENGINE_KEY,
      "Content-Type": "application/json"
    }

    try {
      const { data: label } = await axios.post(`https://api.shipengine.com/v1/labels/rates/${order.metadata.rate_id}`, body, { headers: headers })
      logger.info(`Label for order ${order.id}: ${label.label_download.href}`)
      completedOrder = {
        ...completedOrder,
        shippingLabelInfo: {
          url: label.label_download.href,
          id: label.label_id,
          trackingNumber: label.tracking_number,
          shipmentId: label.shipment_id,
        }
      }

      logger.info(`Updating order ${order.id} with label ${label.label_id}`)
      const orderPromise = await ordersApi.updateOrder(order.id, {
        order: {
          locationId: process.env.SQUARE_LOC_ID,
          metadata: {
            ...order.metadata,
            shippingLabelId: label.label_id,
            shipmentId: label.shipment_id,
            shippingLabelUrl: label.label_download.href
          },
          version: order.version
        }
      })
      const { order: updatedOrder } = orderPromise.result
      logger.info(`Order ${updatedOrder.id} updated with shipping label id ${updatedOrder.metadata.shippingLabelId}`)
    } catch(e) {
      logger.error(`Error completing order ${order.id}`)

      let exception = {}
      if(e.errors) {
        exception = {
          status: 400,
          message: `Couldn't update order with shipment information.`,
          data: e.errors,
          code: ORDERS_API_ERROR
        }
      } else {
        if (e.response) {
          if (e.response.status === 404) {
            exception = {
              status: 400,
              message: `Rate for order ${order.id} not found.`,
              data: e.response.data,
              code: SHIPPING_LABEL_ERROR
            }
          } else if (e.resposne.status === 400) {
            exception = {
              status: 400,
              message: `Bad reqest for shipping label for order ${order.id}.`,
              data: e.response.data,
              code: SHIPPING_LABEL_ERROR
            }
          } else {
            exception = {
              status: e.response.status,
              message: `ShipEngine error. Check the data.`,
              data: e.response.data,
              code: SHIPPING_LABEL_ERROR
            }
          }
        } else {
          exception = {
            status: 500,
            message: "Internal Server Error.",
            data: e,
            code: SERVER_ERROR
          }
        }
      }
      
      logger.error(printJSON(exception))
      throw exception
    }
  } else {
    logger.warn(`No label being created for ${order.id}. Might be an old order or a test order.`)
  }

  try {
    for(const tender of order.tenders) {
      if(tender.cardDetails.status === 'AUTHORIZED') {
        logger.info(`Completing payment ${tender.paymentId} for order ${order.id}`)

        const paymentPromise = await paymentsApi.completePayment(tender.paymentId)
        const { payment } = paymentPromise.result

        completedOrder = {
          ...completedOrder,
          receiptUrl: payment.receiptUrl,
          name: `${payment.shippingAddress.firstName} ${payment.shippingAddress.lastName}`,
          shippingAddress: {
            line1: payment.shippingAddress.addressLine1,
            line2: payment.shippingAddress.addressLine2 ? payment.shippingAddress.addressLine2 : undefined,
            line3: payment.shippingAddress.addressLine3 ? payment.shippingAddress.addressLine3 : undefined,
            city: payment.shippingAddress.locality,
            state: payment.shippingAddress.administrativeDistrictLevel1,
            postalCode: payment.shippingAddress.postalCode,
          },
        }
        completedOrder.paymentIds.push(payment.id)
      }
    }
  } catch(e) {
    logger.error(`Error completing payment ${tender.paymentId} for order ${order.id}`)
    const exception = {
      status: 400,
      message: `Error completing payment ${tender.paymentId} from order ${order.id}`,
      data: e.errors,
      code: PAYMENTS_API_ERROR
    }

    logger.error(exception)
    throw exception
  }

  return completedOrder
}

logger.info(`Connecting to MongoDB at ${url}`)
MongoClient.connect(url, { useUnifiedTopology: true }, (err, client) => {
  if(err) throw err

  // DB Set-up
  const db = client.db('ibdb')

  // Collection Set-up
  logger.info("Getting 'beats' collection...")
  db.collection('beats', (beatsError, beats) => {
    if(beatsError) throw beatsError
    if(beats) logger.info("'beats' collection retrieved")

    logger.info("Getting 'credits' collection...")
    db.collection('credits', (creditsError, credits) => {
      if(creditsError) throw creditsError
      if(credits) logger.info("'credits' collection retrieved")

      logger.info("Getting 'merch' collection...")
      db.collection('merch', (merchError, merch) => {
        if(merchError) throw merchError
        if(merch) logger.info("'merch' collection retrieved")

        logger.info("Getting 'projects' collection...")
        db.collection('projects', (projectsError, projects) => {
          if(projectsError) throw projectsError
          if(projects) logger.info("'projects' collection retrieved")

          logger.info("Getting 'singles' collection...")
          db.collection('singles', (singlesError, singles) => {
            if(singlesError) throw singlesError
            if(singles) logger.info("'singles' collection retrieved")

            logger.info("Getting 'videos' collection...")
            db.collection('videos', (videosError, videos) => {
              if(videosError) throw videosError
              if(videos) logger.info("'videos' collection retrieved")

              // Dead home path
              app.use('/', (req, res, next) => {
                next()
              })
              
              // Proper path handling
              // Beats
              app.route('/beats')
                .get((req, res) => {
                  logger.info(`Getting all beats for request from ${req.ip}`);
                  beats.find().toArray((error, result) => {
                    if(error) throw error

                    res.json(result)
                  })
                })
              
              // Credits
              app.route('/credits')
                .get((req, res) => {
                  logger.info(`Getting all credits for request from ${req.ip}`);
                  credits.find().toArray((error, result) => {
                    if(error) throw error

                    res.json(result)
                  })
                })

              // Customers
              app.route('/customers/:customerId')
                .get((req, res, next) => {
                  const customerId = req.params.customerId
                  
                  if (customerId === 'email') {
                    next()
                  } else {
                    const { customersApi } = squareClient
                    logger.info(`Getting customer ${customerId}`)
  
                    customersApi.retrieveCustomer(customerId)
                      .then(customerFulfilled => customerFulfilled.result.customer).then(customer => {
                        logger.info(`Customer ${customerId} with email ${customer.emailAddress} retrieved`)
                        const customerRetVal = {
                          id: customer.id,
                          firstName: customer.givenName,
                          lastName: customer.familyName,
                          email: customer.emailAddress
                        }
  
                        logger.info(printJSON(customerRetVal))
  
                        res.json(customerRetVal)
                      }).catch(customerError => {
                        logger.error(`Customer ${customerId} not found.`)
                        throw {
                          status: 404,
                          message: `Customer ${customerId} not found.`,
                          data: customerError.errors,
                          code: CUSTOMERS_API_ERROR
                        }
                      })
                  }
                })

              // TODO Log
              app.route('/customers/:customerId/orders')
                .get((req, res) => {
                  const { ordersApi } = squareClient
                  const customerId = req.params.customerId

                  ordersApi.searchOrders({
                    locationIds: [process.env.SQUARE_LOC_ID],
                    returnEntries: false,
                    query: {
                      filter: {
                        customerFilter: {
                          customerIds: [customerId]
                        }
                      }
                    }
                  }).then(ordersFulfilled => ordersFulfilled.result.orders).then(orders => {
                    let response = []
                    for(let order of orders) {
                      let cart = []
                      for(let item of order.lineItems) {
                        if (item.uid !== 'shipping') {
                          cart.push({
                            uid: item.uid,
                            id: item.metadata.id,
                            name: item.name,
                            quantity: Number.parseInt(item.quantity),
                            price: Number.parseInt(item.totalMoney.amount) / 100
                          })
                        }
                      }
                      const shipping = Number.parseInt(order.lineItems.find(item => item.uid === 'shipping').totalMoney.amount) / 100
                      const totalCost = Number.parseInt(order.totalMoney.amount) / 100
                      
                      let payments = []
                      for(let payment of order.tenders) {
                        payments.push({
                          id: payment.id,
                          amount: Number.parseInt(payment.amountMoney.amount) / 100,
                          cardDetails: payment.type === 'CARD'
                            ? {
                              brand: payment.cardDetails.card.cardBrand,
                              last4: payment.cardDetails.card.last4,
                              expMonth: payment.cardDetails.card.expMonth,
                              expYear: payment.cardDetails.card.expYear
                            } : undefined
                        })
                      }

                      response.push({
                        id: order.id,
                        cart: cart,
                        shipping: shipping,
                        totalCost: totalCost,
                        createdDate: order.createdAt,
                        state: order.state,
                        shippingAddress: {
                          line1: order.metadata.shippingLine1,
                          line2: order.metadata.shippingLine2,
                          line3: order.metadata.shippingLine3,
                          city: order.metadata.shippingCity,
                          state: order.metadata.shippingState,
                          postalCode: order.metadata.shippingPostalCode
                        },
                        payments: payments
                      })
                    }
                    
                    res.json(JSON.parse(printJSON(response)))
                  }).catch(orderError => logger.error(orderError))
                })

              app.route('/customers/email')
                .get((req, res) => {
                  const { customersApi } = squareClient
                  const { email } = req.body

                  customersApi.searchCustomers({
                    query: {
                      filter: {
                        emailAddress: {
                          exact: email
                        }
                      }
                    }
                  }).then(customerFulfilled => customerFulfilled.result.customers).then(customers => {
                    const customer = customers[0]
                    
                    let code = ""
                    for(let i = 0; i < 8; i++) {
                      code = code.concat(characters.charAt(Math.floor(Math.random() * characters.length)))
                    }

                    axios.post('https://api.emailjs.com/api/v1.0/email/send', {
                      service_id: process.env.EMAILJS_SERVICE,
                      template_id: process.env.EMAILJS_CODE_TEMPLATE,
                      user_id: process.env.EMAILJS_ID,
                      accessToken: process.env.EMAILJS_TOKEN,
                      template_params: {
                        first_name: customer.givenName,
                        code: code,
                        email: customer.emailAddress
                      }
                    }, {
                      headers: {
                        "Content-Type": "application/json",
                        "Host": "api.emailjs.com"
                      }
                    }).then(emailFulfilled => {
                      logger.info(`${emailFulfilled.status} - Code ${code} sent to customer with email ${customer.emailAddress}`)
                      const response = {
                        id: customer.id,
                        firstName: customer.givenName,
                        lastName: customer.familyName,
                        email: customer.emailAddress
                      }
                      logger.info(`Customer Retrieved via email:\n${printJSON(response)}`)
  
                      res.json(response)
                    }).catch(emailError => {
                      logger.error(`Error emailing order confirmation email to customer with email ${customer.emailAddress}`)
                      const exception = {
                        status: 500,
                        message: `Internal Server Error`,
                        data: emailError,
                        code: EMAILJS_ERROR
                      }

                      logger.error(printJSON(exception))
                      res.status(exception.status).json(exception)
                    })
                  }).catch(customersError => logger.info(customersError))
                })

              app.route('/health')
                .get((req, res) => res.status(200).send())

              // Merchandise
              app.route('/merch')
                .get((req, res) => {
                  logger.info(`Getting all merch for request from ${req.ip}`);
                  merch.find().toArray((error, result) => {
                    if(error) throw error

                    res.json(result)
                  })
                })
              
              // Orders
              app.route('/orders')
                .post((req, res) => {
                  const placeOrder = async (customer, cardToken, orderRequest) => {
                    const { ordersApi, paymentsApi } = squareClient
                  
                    const {
                      firstName,
                      lastName,
                      cart,
                      shippingAddress,
                      email,
                      billingAddress,
                    } = orderRequest
                  
                    const {
                      line1: shippingLine1,
                      line2: shippingLine2,
                      line3: shippingLine3,
                      city: shippingCity,
                      state: shippingState,
                      postalCode: shippingPostalCode
                    } = shippingAddress
                  
                    const {
                      line1: billingLine1,
                      line2: billingLine2,
                      line3: billingLine3,
                      city: billingCity,
                      state: billingState,
                      postalCode: billingPostalCode
                    } = billingAddress
                  
                    // Mapping cart to line items
                    let lineItems = []
                    let shippingLabelItems = []
                    let weight = 0

                    logger.info('Loading cart and calculating price and weight')
                    for (let item of cart) {
                      try {
                        const merchItem = await merch.findOne({id: item.merchId})
  
                        const itemSize = item.sizeId && merchItem.sizes
                          ? merchItem.sizes.find(size => size.id === item.sizeId)
                          : undefined
  
                        if((itemSize && itemSize.quantity === 0) || merchItem.quantity === 0) {
                          logger.error(`${merchItem.name}${itemSize ? `(${itemSize.name})` : ``} is sold out.`)
  
                          throw {
                            status: 400,
                            message: `${merchItem.name}${itemSize ? ` (${itemSize.name})` : ``} is sold out.`,
                            data: {
                              mechId: merchItem.id,
                              name: `${merchItem.name}${itemSize ? ` (${itemSize.name})` : ``}`,
                              request: item.quantity,
                              stock: 0
                            },
                            code: SOLD_OUT
                          }
                        } else if ((itemSize && itemSize.quantity < item.quantity) || merchItem.quantity < item.quantity) {
                          const itemQuantity = itemSize ? itemSize.quantity : merchItem.quantity
                          logger.error(`${merchItem.name}${itemSize ? `(${itemSize.name})` : ``} has less in stock than the requested amount.\nRequested Amount: ${item.quantity}\nAmount In Stock: ${itemQuantity}`)
  
                          throw {
                            status: 400,
                            message: `${merchItem.name}${itemSize ? ` (${itemSize.name})` : ``} has less in stock than the requested amount.`,
                            data: {
                              mechId: merchItem.id,
                              name: `${merchItem.name}${itemSize ? ` (${itemSize.name})` : ``}`,
                              request: item.quantity,
                              stock: itemQuantity
                            },
                            code: TOO_MANY
                          }
                        } else {
                          const itemPrice = itemSize && itemSize.price ? itemSize.price : merchItem.price
                          const itemWeight = itemSize ? itemSize.weight : merchItem.weight
  
                          lineItems.push({
                            quantity: item.quantity.toString(),
                            basePriceMoney: {
                              amount: itemPrice * 100,
                              currency: 'USD'
                            },
                            name: `${merchItem.name}${itemSize ? ` (${itemSize.name})` : ``}`,
                            uid: uuid(),
                            metadata: itemSize ? {
                              id: merchItem.id,
                              sizeId: itemSize.id
                            } : { id: merchItem.id }
                          })
  
                          shippingLabelItems.push({
                            name: `${merchItem.name}${itemSize ? ` (${itemSize.name})` : ``}`,
                            quantity: item.quantity,
                          })
  
                          weight += (itemWeight * item.quantity)
                        }
                      } catch (merchFindError) {
                        if(merchFindError.code === SOLD_OUT || merchFindError.code === TOO_MANY) {
                          throw merchFindError
                        } else {
                          logger.error(`Merch item ${item.merchId} not found`)
                          const exception = {
                            status: 400,
                            message: `Merch item ${item.merchId} not found`,
                            data: merchFindError,
                            code: NOT_FOUND
                          }

                          throw exception
                        }
                      }
                    }
                  
                    const body = {
                      shipment: {
                        validate_address: "validate_and_clean",
                        ship_to: {
                          name: `${firstName} ${lastName}`,
                          address_line1: shippingLine1,
                          address_line2: shippingLine2,
                          address_line3: shippingLine3,
                          city_locality: shippingCity,
                          state_province: shippingState,
                          postal_code: shippingPostalCode,
                          country_code: "US",
                        },
                        ship_from: {
                          name: "Isaiah Bullard",
                          phone: "5122419507",
                          address_line1: "P.O. Box 1166",
                          city_locality: "Bentonville",
                          state_province: "AR",
                          postal_code: "72712",
                          country_code: "US",
                        },
                        packages: [
                          {
                            weight: {
                              value: weight,
                              unit: "ounce"
                            }
                          }
                        ],
                        items: shippingLabelItems
                      },
                      rate_options: {
                        carrier_ids: [carrierCode],
                        service_codes: ['usps_first_class_mail', 'usps_parcel_select']
                      }
                    }
                    
                    let orderId = null
                    let orderVersion = null
                    try {
                      const shippingRateResponse = await axios.post("https://api.shipengine.com/v1/rates", body, {
                        headers: {
                          "Host": "api.shipengine.com",
                          "API-Key": process.env.SHIPENGINE_KEY,
                          "Content-Type": "application/json"
                        }
                      })
                  
                      if(Array.isArray(shippingRateResponse.data.rate_response.rates)) {
                        const rates = shippingRateResponse.data.rate_response.rates
                  
                        const trackableRates = rates.filter((rate) => rate.trackable === true && serviceCodes.includes(rate.service_code) && rate.package_type === "package")
                        let lowestRate = trackableRates[0]
                        for(let rate of trackableRates) {
                          if(rate.shipping_amount.amount < lowestRate.shipping_amount.amount) {
                            lowestRate = rate
                          }
                        }
                  
                        const shippingRate = lowestRate.shipping_amount.amount
                  
                        lineItems.push({
                          quantity: "1",
                          basePriceMoney: {
                            amount: Math.ceil(shippingRate * 100),
                            currency: 'USD',
                          },
                          name: 'Shipping',
                          uid: 'shipping'
                        })
                  
                        logger.info(`Creating Order for user with email ${email}`)
                        const orderResponse = await ordersApi.createOrder({
                          idempotencyKey: uuid(),
                          order: {
                            locationId: process.env.SQUARE_LOC_ID,
                            lineItems: lineItems,
                            customerId: customer ? customer.id : undefined,
                            metadata: {
                              rate_id: lowestRate.rate_id,
                              shippingLine1,
                              shippingLine2: shippingLine2 ? shippingLine2 : " ",
                              shippingLine3: shippingLine3 ? shippingLine3 : " ",
                              shippingCity,
                              shippingState,
                              shippingPostalCode
                            }
                          }
                        })
                                        
                        const order = orderResponse.result.order
                        logger.info(`Order created: ${printJSON(order)}`)
                
                        orderId = order.id
                        orderVersion = order.version
                        logger.info(`Creating Payment for Order with id ${orderId}`)
                
                        const paymentResponse = await paymentsApi.createPayment({
                          sourceId: cardToken,
                          idempotencyKey: uuid(),
                          amountMoney: {
                            amount: order.totalMoney.amount,
                            currency: "USD",
                          },
                          shippingAddress: {
                            firstName: firstName,
                            lastName: lastName,
                            addressLine1: shippingLine1,
                            addressLine2: shippingLine2,
                            addressLine3: shippingLine3,
                            locality: shippingCity,
                            administrativeDistrictLevel1: shippingState,
                            postalCode: shippingPostalCode,
                            country: 'US'
                          },
                          billingAddress: {
                            firstName: firstName,
                            lastName: lastName,
                            addressLine1: billingLine1,
                            addressLine2: billingLine2,
                            addressLine3: billingLine3,
                            locality: billingCity,
                            administrativeDistrictLevel1: billingState,
                            postalCode: billingPostalCode,
                            country: 'US'
                          },
                          buyerEmailAddress: email,
                          orderId: orderId,
                          customerId: customer ? customer.id : undefined,
                          autocomplete: false
                        })
                
                        const payment = paymentResponse.result.payment
                        logger.info(`Payment Created: ${printJSON(payment)}`)

                        for (let item of cart) {
                          try {
                            const merchItem = await merch.findOne({id: item.merchId})
      
                            const itemSize = item.sizeId && merchItem.sizes
                              ? merchItem.sizes.find(size => size.id === item.sizeId)
                              : undefined
      
                            if(itemSize) {
                              await merch.updateOne({_id: merchItem._id, "sizes.id": itemSize.id}, {
                                $inc: {
                                  "sizes.$.quantity": -1 * item.quantity
                                }
                              })
                            } else {
                              await merch.updateOne({_id: merchItem._id}, {
                                $inc: { quantity: -1 * item.quantity }
                              })
                            }
                          } catch (merchFindError) {
                            logger.error(`Merch item ${item.merchId} not found`)
                            const exception = {
                              status: 400,
                              message: `Merch item ${item.merchId} not found`,
                              data: merchFindError,
                              code: NOT_FOUND
                            }
  
                            throw exception
                          }
                        }
  
                        
                
                        let response = {
                          customer: customer ? {
                            id: customer.id,
                            email: customer.emailAddress,
                            firstName: customer.givenName,
                            lastName: customer.familyName,
                          } : {},
                          totalCost: Number.parseInt(payment.totalMoney.amount.toString())/100,
                          shippingRate: shippingRate,
                          orderId: order.id,
                        }
                
                        logger.info(`Sending order response: ${printJSON(response)}`)
                        return response
                      }
                    } catch (e) {
                      if (e.errors) {
                        if (orderId) {
                          logger.error(`Error in creating payment for order ${orderId} with email ${email}.`)
                          logger.error(printJSON(e.errors))
                          const exception = {
                            status: 500,
                            message: `Server error creating payment for order ${orderId} with email ${email}.`,
                            data: e.errors,
                            code: PAYMENTS_API_ERROR
                          }

                          logger.error(printJSON(exception))
                          res.status(exception.status).json(exception)

                          ordersApi.updateOrder(orderId, {
                            order: {
                              locationId: process.env.SQUARE_LOC_ID,
                              state: 'CANCELED',
                              version: orderVersion
                            }
                          }).then(orderFulfilled => orderFulfilled.result.order).then(order => {
                            logger.info(`Removed order ${orderId} because of payment error`)
                          }).catch(orderError => {
                            logger.error(`Error canceling order ${orderId} after payment failure.`)
                            logger.error(printJSON(orderError))
                          })
                        } else {
                          logger.error(`Error in creating order for customer with email ${email}.`)
                          logger.error(printJSON(e.errors))
                          const exception = {
                            status: 500,
                            message: `Server error in creating order for customer with email ${email}.`,
                            data: e.errors,
                            code: ORDERS_API_ERROR
                          }

                          throw exception
                        }
                      } else if(e.response) {
                        logger.error("Error in the ShipEngine API")
                        if (e.response.status === 400 && e.response.data.errors[0].error_type === "validation") {
                          const exception = {
                            status: 400,
                            message: `Error creating a rate for order for customer ${customer.id}`,
                            data: e.response.data.errors,
                            code: SHIPPING_RATE_ERROR
                          }

                          throw exception
                        } else {
                          logger.error(e.response.data.errors)
                          throw {
                            status: 500,
                            message: `Error in the ShipEngine API`,
                            data: e.response.data.errors,
                            code: SHIPPING_RATE_ERROR
                          }
                        }
                      } else if(e.code && e.code === NOT_FOUND) {
                        throw e
                      }
                    }
                  }

                  logger.info(`New Order Request: ${printJSON(req.body)}`)

                  const { customersApi, cardsApi } = squareClient

                  const {
                    firstName,
                    lastName,
                    token,
                    shippingAddress,
                    email,
                    billingAddress,
                    cardholderName,
                  } = req.body

                  const {
                    line1: shippingLine1,
                    line2: shippingLine2,
                    line3: shippingLine3,
                    city: shippingCity,
                    state: shippingState,
                    postalCode: shippingPostalCode
                  } = shippingAddress

                  const {
                    line1: billingLine1,
                    line2: billingLine2,
                    line3: billingLine3,
                    city: billingCity,
                    state: billingState,
                    postalCode: billingPostalCode
                  } = billingAddress

                  logger.info(`Retrieving customer with email ${email}`)
                  customersApi.searchCustomers({
                    query: {
                      filter: {
                        emailAddress: {
                          exact: email
                        }
                      }
                    }
                  })
                  .then(customersFulfilled => customersFulfilled.result.customers)
                  .then(customers => {
                    if(!customers || customers.length === 0) {
                      logger.info(`Creating a new customer for ${firstName} ${lastName} with email ${email}`)
                      customersApi.createCustomer({
                        idempotencyKey: uuid(),
                        givenName: firstName,
                        familyName: lastName,
                        emailAddress: email,
                        address: {
                          firstName: firstName,
                          lastName: lastName,
                          addressLine1: shippingLine1,
                          addressLine2: shippingLine2,
                          addressLine3: shippingLine3,
                          locality: shippingCity,
                          administrativeDistrictLevel1: shippingState,
                          postalCode: shippingPostalCode
                        }
                      })
                      .then(customerFulfilled => customerFulfilled.result.customer)
                      .then(customer => {
                        logger.info(`Customer created in Square: ${printJSON(customer)}`)
                        cardsApi.createCard({
                          sourceId: token,
                          idempotencyKey: uuid(),
                          card: {
                            billingAddress: {
                              firstName: firstName,
                              lastName: lastName,
                              addressLine1: billingLine1,
                              addressLine2: billingLine2,
                              addressLine3: billingLine3,
                              locality: billingCity,
                              administrativeDistrictLevel1: billingState,
                              postalCode: billingPostalCode,
                              country: 'US'
                            },
                            cardholderName: cardholderName,
                            customerId: customer.id,
                          }
                        }).then(cardFulfilled => cardFulfilled.result.card).then(card => {
                          logger.info(`Customer card created: ${printJSON(card)}`)

                          placeOrder(customer, card ? card.id : token, req.body)
                            .then(orderInfo => {

                              logger.info(`Sending order response: ${printJSON(orderInfo)}`)
                              res.status(201).json(orderInfo)

                              logger.info(`Emailing confirmation to customer for order ${orderInfo.orderId} to email ${customer.emailAddress}`)
                              axios.post('https://api.emailjs.com/api/v1.0/email/send', {
                                service_id: process.env.EMAILJS_SERVICE,
                                template_id: process.env.EMAILJS_ORDER_TEMPLATE,
                                user_id: process.env.EMAILJS_ID,
                                accessToken: process.env.EMAILJS_TOKEN,
                                template_params: {
                                  first_name: orderInfo.customer.firstName,
                                  order: orderInfo.orderId,
                                  email: orderInfo.customer.email
                                }
                              }, {
                                headers: {
                                  "Content-Type": "application/json",
                                  "Host": "api.emailjs.com"
                                }
                              }).then(emailFulfilled => logger.info(`${emailFulfilled.status} - Order confirmation email sent to customer with email ${customer.emailAddress}`))
                              .catch(emailError => {
                                logger.error(`Error emailing order confirmation email to customer with email ${customer.emailAddress}`)
                                if (emailError.response) {
                                  logger.error(printJSON(emailError.response.data))
                                } else if (emailError.request) {
                                  logger.error(printJSON(emailError.request))
                                } else {
                                  logger.error(printJSON(emailError.message))
                                }
                              })
                            }).catch(orderCompletionError => {
                              logger.error(orderCompletionError)

                              res.status(orderCompletionError.status).json(orderCompletionError)
                            })
                        }).catch(cardError => {
                          logger.error(`Error creating card for customer ${customer.id}`)
                          const exception = {
                            status: 400,
                            message: `Error creating card for customer ${customer.id}`,
                            data: cardError.errors,
                            code: CARDS_API_ERROR
                          }

                          logger.error(printJSON(exception))
                          res.status(exception.status).json(exception)
                        })
                      }).catch(customerError => {
                        logger.error(`Error creating customer with email ${email}`)
                        const exception = {
                          status: 400,
                          message: `Error creating customer with email ${email}`,
                          data: customerError.errors,
                          code: CUSTOMERS_API_ERROR
                        }

                        logger.error(printJSON(exception))
                        res.status(exception.status).json(exception)
                      })
                    } else {
                      const customer = customers[0]

                      cardsApi.createCard({
                        sourceId: token,
                        idempotencyKey: uuid(),
                        card: {
                          billingAddress: {
                            firstName: firstName,
                            lastName: lastName,
                            addressLine1: billingLine1,
                            addressLine2: billingLine2,
                            addressLine3: billingLine3,
                            locality: billingCity,
                            administrativeDistrictLevel1: billingState,
                            postalCode: billingPostalCode,
                            country: 'US'
                          },
                          cardholderName: cardholderName,
                          customerId: customer.id
                        }
                      }).then(cardFulfilled => cardFulfilled.result.card).then(card => {
                        logger.info(`Customer card created: ${printJSON(card)}`)

                        placeOrder(customer, card ? card.id : token, req.body)
                          .then(orderInfo => {
                            logger.info(`Emailing confirmation to customer for order ${orderInfo.orderId} to email ${customer.emailAddress}`)
                            res.status(201).json(orderInfo)

                            axios.post('https://api.emailjs.com/api/v1.0/email/send', {
                              service_id: process.env.EMAILJS_SERVICE,
                              template_id: process.env.EMAILJS_ORDER_TEMPLATE,
                              user_id: process.env.EMAILJS_ID,
                              accessToken: process.env.EMAILJS_TOKEN,
                              template_params: {
                                first_name: orderInfo.customer.firstName,
                                order: orderInfo.orderId,
                                email: orderInfo.customer.email
                              }
                            }, {
                              headers: {
                                "Content-Type": "application/json",
                                "Host": "api.emailjs.com"
                              }
                            }).then(emailFulfilled => logger.info(`${emailFulfilled.status} - Order confirmation email sent to customer with email ${customer.emailAddress}`))
                            .catch(emailError => {
                              logger.error(`Error emailing order confirmation email to customer with email ${customer.emailAddress}`)
                              logger.error(emailError.toJSON())
                            })
                          }).catch(orderError => {
                            logger.error(orderError)

                            res.status(orderError.status || orderError.status === 0 ? orderError.status : 500).json(orderError)
                          })
                      }).catch(cardError => {
                        logger.error(`Error creating card for customer ${customer.id}`)
                        const exception = {
                          status: 400,
                          message: `Error creating card for customer ${customer.id}`,
                          data: cardError.errors,
                          code: CARDS_API_ERROR
                        }

                        logger.error(printJSON(exception))
                        res.status(exception.status).json(exception)
                      })
                    }
                  }).catch(customerError => {
                    logger.error(`Error retrieving customer with email ${email}`)
                    logger.error(printJSON(customerError))

                    res.status(500).json({
                      status: 500,
                      message: `Error retrieving customer with email ${email}`,
                      data: customerError,
                      code: CUSTOMERS_API_ERROR
                    })
                  })
                })
                .get((req, res) => {
                  logger.info(`Getting all orders`)

                  const { ordersApi } = squareClient

                  ordersApi.searchOrders({
                    returnEntries: false,
                    locationIds: [process.env.SQUARE_LOC_ID]
                  }).then(ordersFulfilled => ordersFulfilled.result.orders).then(orders => {
                    if(!orders) {
                      logger.warn('No orders found.')
                      res.status(404).json({
                        status: 404,
                        message: 'No orders found.',
                        code: NOT_FOUND
                      })
                    } else {
                      logger.info(`${orders.length} orders retrieved`)
                      let result = []
                      for(let order of orders) {
  
                        let items = []
                        let shippingCost = 0
                        for(let item of order.lineItems) {
                          if(item.uid !== 'shipping') {
                            items.push({
                              id: item.uid,
                              name: item.name,
                              quantity: item.quantity,
                              itemPrice: Number.parseFloat(item.basePriceMoney.amount.toString()) / 100,
                              totalPrice: Number.parseFloat(item.totalMoney.amount.toString()) / 100
                            })
                          } else {
                            shippingCost = Number.parseFloat(item.totalMoney.amount.toString()) / 100
                          }
                        }
  
                        let payments = []
                        if(order.tenders) {
                          for(let tender of order.tenders) {
                            payments.push(tender.paymentId)
                          }
                        }
  
                        result.push({
                          id: order.id,
                          customerId: order.customerId,
                          items: items,
                          shippingCost: shippingCost,
                          orderCost: Number.parseFloat(order.totalMoney.amount.toString()) / 100,
                          paymentIds: payments,
                          orderStatus: order.state,
                          shippingAddress: order.metadata && order.metadata.shippingLine1 ? {
                            line1: order.metadata.shippingLine1,
                            line2: order.metadata.shippingLine2 !== ' ' ? order.metadata.shippingLine2 : undefined,
                            line3: order.metadata.shippingLine3 !== ' ' ? order.metadata.shippingLine3 : undefined,
                            city: order.metadata.shippingCity,
                            state: order.metadata.shippingState,
                            postalCode: order.metadata.shippingPostalCode
                          } : undefined,
                          shippingLabelId: order.metadata && order.metadata.shippingLabelId ? order.metadata.shippingLabelId : undefined,
                          shippingLabelUrl: order.metadata && order.metadata.shippingLabelUrl ? order.metadata.shippingLabelUrl : undefined,
                          createdDate: new Date(order.createdAt)
                        })
                      }
  
                      res.json(result)
                    }
                  }).catch(ordersError => {
                    logger.error(`Error retrieving all orders`)
                    const exception = {
                      status: 500,
                      message: `Internal error retrieving all orders from Square.`,
                      data: ordersError.errors,
                      code: ORDERS_API_ERROR
                    }

                    logger.error(printJSON(exception))
                    res.status(exception.status).json(exception)
                  })
                })

              app.route('/orders/admin-auth')
                .post((req, res) => {
                  const user = req.body

                  if(user.email === 'isaiah0812@yahoo.com'
                      && user.nickname === 'isaiah0812'
                      && user.email_verified === true) {
                    const authTime = new Date()
                    logger.info(`Authorized admin user from ${req.ip} at ${authTime.toISOString()}`)
                    res.status(200).json({ authorized: true })
                  } else {
                    const authTime = new Date()
                    logger.info(`Attempted login to admin user from ${req.ip} at ${authTime.toISOString()}`)
                    res.status(200).json({ authorized: false })
                  }
                })

              app.route('/orders/complete')
                .post((req, res) => {
                  const { ordersApi, customersApi } = squareClient

                  ordersApi.searchOrders({
                    locationIds: [process.env.SQUARE_LOC_ID],
                    returnEntries: false,
                    query: {
                      filter: {
                        stateFilter: {
                          states: ["OPEN"]
                        }
                      }
                    }
                  }).then(ordersFulfilled => ordersFulfilled.result.orders.filter(order => order.tenders)).then(orders => {
                    logger.info(`${orders.length} open orders. Completing payments and creating shipping labels.`)
                    const completeOrders = async () => {
                      let completedOrders = []
                      for(let order of orders) {
                        let completedOrder
                        try {
                          completedOrder = await completeOrder(order)
                          completedOrders.push(completedOrder)
                        } catch (orderCompletionError) {
                          throw orderCompletionError
                        }

                        customersApi.retrieveCustomer(order.customerId)
                          .then(customerFulfilled => customerFulfilled.result.customer).then(customer => {
                              logger.info(`Emailing customer for order ${order.id} to email ${customer.emailAddress}`)
                              axios.post('https://api.emailjs.com/api/v1.0/email/send', {
                                service_id: process.env.EMAILJS_SERVICE,
                                template_id: process.env.EMAILJS_SHIPPING_TEMPLATE,
                                user_id: process.env.EMAILJS_ID,
                                accessToken: process.env.EMAILJS_TOKEN,
                                template_params: {
                                  first_name: customer.givenName,
                                  receipt: completedOrder.receiptUrl,
                                  tracking_number: completedOrder.shippingLabelInfo.trackingNumber,
                                  order: order.id,
                                  email: customer.emailAddress
                                }
                              }, {
                                headers: {
                                  "Content-Type": "application/json",
                                  "Host": "api.emailjs.com"
                                }
                              }).then(emailFulfilled => logger.info(`${emailFulfilled.status} - Order completion email sent to customer with email ${customer.emailAddress}`))
                              .catch(emailError => {
                                logger.error(`Error emailing order completion email to customer with email ${customer.emailAddress}`)
                                let exception = {}
                                if (emailError.response) {
                                  if (emailError.resposne.status === 400) {
                                    exception = {
                                      status: 400,
                                      message: `Bad reqest for emailing completion email to customer with email ${customer.emailAddress} for order ${order.id}.`,
                                      data: emailError.response.data,
                                      code: EMAILJS_ERROR
                                    }
                                  } else {
                                    exception = {
                                      status: emailError.response.status,
                                      message: `ShipEngine error. Check the data.`,
                                      data: emailError.response.data,
                                      code: EMAILJS_ERROR
                                    }
                                  }
                                } else {
                                  exception = {
                                    status: 500,
                                    message: "Internal Server Error.",
                                    data: emailError,
                                    code: EMAILJS_ERROR
                                  }
                                }

                                throw(exception)
                              })
                            })
                          .catch(customerError => {
                            if (customerError.code === EMAILJS_ERROR) {
                              throw customerError
                            } else {
                              logger.error(`Error retrieving customer ${order.customerId}`)
                              logger.error(customerError)
                            }
                          })
                      }

                      return completedOrders
                    }

                    completeOrders().then(completedOrders => {
                      logger.info(`Completed ${completedOrders.length} payments`)
                      logger.info(printJSON(completedOrders))

                      res.json(completedOrders)
                    }).catch(orderCompletionError => {
                      logger.error(printJSON(orderCompletionError))

                      res.status(orderCompletionError.status).json(orderCompletionError)
                    })
                  }).catch(ordersError => {
                    logger.error(`Error retrieving open orders`)
                    const exception = {
                      status: 500,
                      message: `Internal error retrieving open orders from Square.`,
                      data: ordersError.errors,
                      code: ORDERS_API_ERROR
                    }

                    logger.error(printJSON(exception))
                    res.status(exception.status).json(JSON.parse(printJSON(exception)))
                  })
                })

              app.route('/orders/merge')
                .post((req, res) => {
                  const mergeLabels = async () => {
                    const { labelUrls } = req.body
                    
                    const headers = {
                      "Host": "api.shipengine.com",
                      "API-Key": process.env.SHIPENGINE_KEY,
                      "Content-Type": "application/json"
                    }

                    try {
                      const mergedPdf = await PDFDocument.create()
                      for(const url of labelUrls) {
                        try {
                          const { data: labelRaw } = await axios.get(url, { 
                            headers: headers,
                            responseType: 'arraybuffer'
                          })

                          const labelPdf = await PDFDocument.load(labelRaw)
                          const [labelPage] = await mergedPdf.copyPages(labelPdf, [0])
                          
                          mergedPdf.addPage(labelPage)
                        } catch (e) {
                          logger.error(`Error getting shipping label with url ${url}`)
                          logger.error(e)
                        }
                        
                      }

                      const mergedPdfBuffer = await mergedPdf.save()
                      
                      res.header('Content-Type', 'application/pdf')
                      res.send(Buffer.from(mergedPdfBuffer))
                    } catch(e) {
                      logger.error(`Error merging shipping labels`)
                      const exception = {
                        status: 400,
                        message: `Error merging shipping labels`,
                        data: {
                          error: e,
                          success: false
                        },
                        code: SERVER_ERROR
                      }
                      logger.error(printJSON(exception))

                      res.status(exception.status).json(exception)
                    }
                  }

                  mergeLabels()
                })

              app.route('/orders/:orderId/cancel')
                .put((req, res) => {
                  const orderId = req.params.orderId
                  const { ordersApi, customersApi } = squareClient

                  ordersApi.retrieveOrder(orderId)
                    .then(orderFound => orderFound.result.order).then(order => {
                      if(!order) {
                        logger.error(`Order ${orderId} not found`)
                        const exception = {
                          status: 404,
                          message: `Order ${orderId} not found`,
                          data: {
                            orderId: orderId
                          },
                          code: NOT_FOUND
                        }

                        logger.error(printJSON(exception))
                        res.status(exception.status).json(exception)
                      } else {
                        logger.info(`Found order ${order.id}.`)

                        if (order.state === 'COMPLETED' || order.state === 'CANCELED') {
                          logger.error(`Order ${order.id} is in state ${order.state}, and cannot be updated.`)
                          const exception = {
                            status: 400,
                            message: `Order ${orderId} not found`,
                            data: {
                              orderId: order.id,
                              state: order.state
                            },
                            code: BAD_REQUEST
                          }

                          logger.error(printJSON(exception))
                          res.status(exception.status).json(exception)
                        } else {
                          logger.info(`Canceling order ${orderId}...`)

                          ordersApi.updateOrder(order.id, {
                            order: {
                              version: order.version,
                              locationId: process.env.SQUARE_LOC_ID,
                              state: 'CANCELED'
                            }
                          }).then(canceledResult => canceledResult.result.order).then(canceledOrder => {
                            if(!canceledOrder) {
                              logger.error(`Error canceling order. Might need to be done manually.`)
                              const exception = {
                                status: 500,
                                message: `Error canceling order. Might need to be done manually.`,
                                data: {
                                  orderId: order.id
                                },
                                code: SERVER_ERROR
                              }

                              logger.error(printJSON(exception))
                              res.status(exception.status).json(exception)
                            } else {
                              logger.info(`Order ${canceledOrder.id} canceled.`)

                              res.status(204).send()

                              const customerId = canceledOrder.customerId
                              if (!customerId) {
                                logger.warn(`No customer associated with order ${canceledOrder.id}. Cannot send cancelation email.`)
                              } else {
                                logger.info(`Finding customer for order ${canceledOrder.id}`)
                                customersApi.retrieveCustomer(customerId)
                                  .then(customerFound => customerFound.result.customer).then(customer => {
                                    if(!customer) {
                                      logger.warn(`Customer ${customerId} not found. Not sending cancelation email.`)
                                    } else {
                                      logger.info(`Sending cancelation confirmation email to customer with email ${customer.emailAddress}`)

                                      axios.post('https://api.emailjs.com/api/v1.0/email/send', {
                                        service_id: process.env.EMAILJS_SERVICE,
                                        template_id: process.env.EMAILJS_CANCEL_TEMPLATE,
                                        user_id: process.env.EMAILJS_ID,
                                        accessToken: process.env.EMAILJS_TOKEN,
                                        template_params: {
                                          first_name: customer.givenName,
                                          order: order.id,
                                          email: customer.emailAddress
                                        }
                                      }, {
                                        headers: {
                                          "Content-Type": "application/json",
                                          "Host": "api.emailjs.com"
                                        }
                                      }).then(emailFulfilled => logger.info(`${emailFulfilled.status} - Cancelation confirmation email sent to customer with email ${customer.emailAddress}`))
                                      .catch(emailError => {
                                        logger.error(`Error emailing order confirmation email to customer with email ${customer.emailAddress}`)
                                        logger.error(emailError.toJSON())
                                      })
                                    }
                                  }).catch(customerFindError => {
                                    logger.error(`Error in finding customer ${customerId}.`)
                                    logger.error(customerFindError.errors)
                                  })
                              }
                            }
                          }).catch(orderUpdateError => {
                            logger.error(`Error in canceling order ${orderId}.`)
                            const exception = {
                              status: 400,
                              message: `Server error in canceling order ${orderId}.`,
                              data: orderUpdateError.errors,
                              code: ORDERS_API_ERROR
                            }
                            
                            logger.error(printJSON(exception))
                            res.status(exception.status).json(exception)
                          })
                        }
                      }
                    }).catch(orderFindError => {
                      logger.error(`Error in finding order ${orderId}.`)
                      const exception = {
                        status: 400,
                        message: `Server error in finding order ${orderId}.`,
                        data: orderFindError.errors,
                        code: ORDERS_API_ERROR
                      }
                      
                      logger.error(printJSON(exception))
                      res.status(exception.status).json(exception)
                    })
                })

              app.route('/orders/:orderId/complete')
                .post((req, res) => {
                  const { ordersApi, customersApi } = squareClient
                  const { orderId } = req.params

                  ordersApi.retrieveOrder(req.params.orderId)
                    .then(orderFulfilled => orderFulfilled.result.order).then(order => {
                      completeOrder(order).then(completedOrder => {
                        logger.info(`Completed order ${completedOrder.id}`)
                        logger.info(printJSON(completedOrder))

                        res.json(JSON.parse(printJSON(completedOrder)))

                        customersApi.retrieveCustomer(order.customerId)
                          .then(customerFulfilled => customerFulfilled.result.customer).then(customer => {
                            logger.info(`Emailing customer for order ${order.id} to email ${customer.emailAddress}`)
                            axios.post('https://api.emailjs.com/api/v1.0/email/send', {
                              service_id: process.env.EMAILJS_SERVICE,
                              template_id: process.env.EMAILJS_SHIPPING_TEMPLATE,
                              user_id: process.env.EMAILJS_ID,
                              accessToken: process.env.EMAILJS_TOKEN,
                              template_params: {
                                first_name: customer.givenName,
                                receipt: completedOrder.receiptUrl,
                                tracking_number: completedOrder.shippingLabelInfo.trackingNumber,
                                order: order.id,
                                email: customer.emailAddress
                              }
                            }, {
                              headers: {
                                "Content-Type": "application/json",
                                "Host": "api.emailjs.com"
                              }
                            }).then(emailFulfilled => logger.info(`${emailFulfilled.status} - Order completion email sent to customer with email ${customer.emailAddress}`))
                            .catch(emailError => {
                              logger.error(`Error emailing order completion email to customer with email ${customer.emailAddress}`)
                              logger.error(emailError.toJSON())
                            })
                          }).catch(customerRejected => logger.error(customerRejected))
                      }).catch(orderCompletionError => {
                        logger.error(printJSON(orderCompletionError))

                        res.status(orderCompletionError.status).json(orderCompletionError)
                      })
                    }).catch(orderError => {
                      logger.error(`Error retrieving order ${orderId} from Square`)
                      const exception = {
                        status: 400,
                        message: `Error retrieving order ${orderId} from Square`,
                        data: orderError,
                        code: ORDERS_API_ERROR
                      }

                      logger.error(printJSON(exception))
                      res.status(exception.status).json(exception)
                    })
                })

              app.route('/orders/:orderId/label')
                .get((req, res) => {
                  const orderId = req.params.orderId
                  const { ordersApi } = squareClient
                  
                  logger.info(`Retrieving order ${orderId}`)
                  ordersApi.retrieveOrder(orderId)
                    .then(orderFound => orderFound.result.order).then(order => {
                      if(!order) {
                        logger.error(`Order ${orderId} not found`)
                        const exception = {
                          status: 404,
                          message: `Order ${orderId} not found`,
                          data: {
                            orderId: orderId
                          },
                          code: NOT_FOUND
                        }

                        logger.error(printJSON(exception))
                        res.status(exception.status).json(exception)
                      } else {
                        logger.info(`Order ${order.id} found.`)
                        if(order.metadata) {
                          if(order.metadata.shippingLabelUrl) {
                            res.status(200).json({
                              id: order.id,
                              url: order.metadata.shippingLabelUrl
                            })
                          } else if(order.metadata.shippingLabelId) {
                            logger.info(`Retrieving shipping label ${order.metadata.shippingLabelId} from ShipEngine`)
                            const headers = {
                              "Host": "api.shipengine.com",
                              "API-Key": process.env.SHIPENGINE_KEY,
                              "Content-Type": "application/json"
                            }

                            axios.get(`https://api.shipengine.com/v1/labels/${order.metadata.shippingLabelId}`, { headers: headers })
                              .then(shippingLabelResult => {
                                const label = shippingLabelResult.data

                                logger.info(`Received label ${label.label_id} for order ${order.id} - ${label.label_download.href}`)
                                res.status(200).json({
                                  id: order.id,
                                  url: label.label_download.href
                                })
                              })
                              .catch(shippingLabelError => {
                                logger.info(`Error retrieving shipping label for order ${order.id}`)
                                const exception = {
                                  status: 500,
                                  message: `Error retrieving shipping label for order ${order.id}`,
                                  data: shippingLabelError,
                                  code: SHIPPING_LABEL_ERROR
                                }

                                logger.error(printJSON(exception))
                                res.status(exception.status).json(exception)
                              })
                          } else {
                            logger.warn(`Order does not have a shipping label.`)
                            const exception = {
                              status: 400,
                              message: `Order ${order.id} does not have a shipping label`,
                              data: {
                                orderId: order.id,
                              },
                              code: NOT_FOUND
                            }

                            res.status(exception.status).json(exception)
                          }
                        } else {
                          logger.warn(`No label for order ${order.id}.`)
                          const exception = {
                            status: 404,
                            message: `No label for order ${order.id} found`,
                            data: {
                              orderId: order.id,
                            },
                            code: NOT_FOUND
                          }

                          logger.error(printJSON(exception))
                          res.status(exception.status).json(exception)
                        }
                      }
                    }).catch(findOrderError => {
                      logger.error(`Error finding order ${orderId}`)
                      const exception = {
                        status: 500,
                        message: `Error finding order ${orderId}`,
                        data: findOrderError,
                        code: ORDERS_API_ERROR
                      }

                      logger.info(printJSON(exception))
                      res.status(exception.status).send(exception)
                    })

                })

              app.route('/orders/rates/estimate')
                .post((req, res) => {
                  const { postalCode, weight } = req.body

                  const ship_date = new Date().toISOString()

                  const body = {
                    from_country_code: "US",
                    from_postal_code: "72712",
                    to_country_code: "US",
                    to_postal_code: postalCode,
                    weight: weight,
                    ship_date: ship_date,
                    carrier_ids: [carrierCode]
                  }

                  axios.post("https://api.shipengine.com/v1/rates/estimate", body, {
                    headers: {
                      "Host": "api.shipengine.com",
                      "API-Key": process.env.SHIPENGINE_KEY,
                      "Content-Type": "application/json"
                    }
                  }).then((rateFulfilled) => {
                    if(Array.isArray(rateFulfilled.data)) {
                      const rates = rateFulfilled.data

                      const trackableRates = rates.filter((rate) => {
                        return rate.trackable === true && serviceCodes.includes(rate.service_code) && rate.package_type === "package"
                      })
                      let lowestRate = trackableRates[0]
                      for(let rate of trackableRates) {
                        if(rate.shipping_amount.amount < lowestRate.shipping_amount.amount) {
                          lowestRate = rate
                        }
                      }

                      logger.info(`Estimated rate for ${postalCode}: $${lowestRate.shipping_amount.amount}`)

                      res.status(200).json({
                        rate: lowestRate.shipping_amount.amount,
                      })
                    }
                    else {
                      res.status(400).json(JSON.parse(rateFulfilled.body))
                    }

                  }).catch((ratesError) => {
                    if (ratesError.response) {
                      if(ratesError.response.status === 400) {
                        logger.error(`Bad request when estimating rate`)
                        const exception = {
                          status: 400,
                          message: `Bad request when estimating rate`,
                          data: ratesError.response.data,
                          code: SHIPPING_RATE_ERROR
                        }

                        logger.error(printJSON(exception))
                        res.status(exception.status).json(exception)
                      } else {
                        logger.error(`ShipEngine Error`)
                        const exception = {
                          status: ratesError.response.status,
                          message: `ShipEngine Error`,
                          data: ratesError.response.data,
                          code: SHIPENGINE_ERROR
                        }

                        logger.error(printJSON(exception))
                        res.status(exception.status).json(exception)
                      }
                    } else {
                      logger.error(`Internal Server Error.`)
                      const exception = {
                        status: 500,
                        message: `Internal Server Error.`,
                        data: ratesError,
                        code: SERVER_ERROR
                      }

                      logger.error(printJSON(exception))
                      res.status(exception.status).json(exception)
                    }
                  })
                })
              
              // Projects
              app.route('/projects')
                .get((req, res) => {
                  const beatTape = req.query.beatTape // beatTape query parameter
                  switch(beatTape) {
                    // Return only Beat Tapes
                    case 'true': 
                      logger.info(`Getting all beat tapes for request from ${req.ip}`);
                      projects.find({ beatTape: true }).toArray((error, result) => {
                        if(error) throw error
                        res.json(result)
                      })
                      break;
                    // Return only Albums
                    case 'false': 
                      logger.info(`Getting all albums for request from ${req.ip}`);
                      projects.find({ beatTape: false }).toArray((error, result) => {
                        if(error) throw error
                
                        res.json(result)
                      })
                      break;
                    // Return all Projects
                    default: 
                      logger.info(`Getting all projects for request from ${req.ip}`);
                      projects.find().toArray((error, result) => {
                        if(error) throw error
                
                        res.json(result)
                      })
                      break;
                  }
                })
              
              // Singles
              app.route('/singles')
                .get((req, res) => {
                  logger.info(`Getting all singles for request from ${req.ip}`);
                  singles.find().toArray((error, result) => {
                    if(error) throw error

                    res.json(result)
                  })
                })

              // Videos
              app.route('/videos')
                .get((req, res) => {
                  logger.info(`Getting all videos for request from ${req.ip}`);
                  videos.find().toArray((error, result) => {
                    if(error) throw error

                    res.json(result)
                  })
                })
              
              // Listener
              app.listen(port, () => {
                logger.info(`The ZaePI is listening on port ${port}!`)
              })
            })
          })
        })
      })
    })
  })
})