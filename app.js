require('dotenv').config()

const express = require('express')
const app = express()
const cors = require('cors')
const { v4: uuid } = require('uuid')
const { Client, Environment } = require('square')
const axios = require('axios')
const { PDFDocument } = require('pdf-lib')
const emailjs = require('emailjs-com')

const port = 8080
const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

const squareClient = new Client({
  environment: Environment.Sandbox,
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
  console.info(`Completing order ${order.id}${order.customerId ? ` for customer with id ${order.customerId}` : ''}`)
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
    console.info(`Creating shipping label for order ${order.id}`)
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
      console.info(`Label for order ${order.id}: ${label.label_download.href}`)
      completedOrder = {
        ...completedOrder,
        shippingLabelInfo: {
          url: label.label_download.href,
          id: label.label_id,
          trackingNumber: label.tracking_number,
          shipmentId: label.shipment_id,
        }
      }

      console.info(`Updating order ${order.id} with label ${label.label_id}`)
      const orderPromise = await ordersApi.updateOrder(order.id, {
        order: {
          locationId: process.env.SQUARE_LOC_ID,
          metadata: {
            ...order.metadata,
            shippingLabelId: label.label_id,
            shipmentId: label.shipment_id
          },
          version: order.version
        }
      })
      const { order: updatedOrder } = orderPromise.result
      console.info(`Order ${updatedOrder.id} updated with shipping label id ${updatedOrder.metadata.shippingLabelId}`)
    } catch(e) {
      console.error(`Error completing order ${order.id}`)

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
      
      console.error(printJSON(exception))
      throw exception
    }
  } else {
    console.warn(`No label being created for ${order.id}. Might be an old order or a test order.`)
  }

  try {
    for(const tender of order.tenders) {
      if(tender.cardDetails.status === 'AUTHORIZED') {
        console.info(`Completing payment ${tender.paymentId} for order ${order.id}`)

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
    console.error(`Error completing payment ${tender.paymentId} for order ${order.id}`)
    const exception = {
      status: 400,
      message: `Error completing payment ${tender.paymentId} from order ${order.id}`,
      data: e.errors,
      code: PAYMENTS_API_ERROR
    }

    console.error(exception)
    throw exception
  }

  return completedOrder
}

console.info(`Connecting to MongoDB at ${url}`)
MongoClient.connect(url, { useUnifiedTopology: true }, (err, client) => {
  if(err) throw err

  // DB Set-up
  const db = client.db('ibdb')

  // Collection Set-up
  console.info("Getting 'beats' collection...")
  db.collection('beats', (beatsError, beats) => {
    if(beatsError) throw beatsError
    if(beats) console.info("'beats' collection retrieved")

    console.info("Getting 'credits' collection...")
    db.collection('credits', (creditsError, credits) => {
      if(creditsError) throw creditsError
      if(credits) console.info("'credits' collection retrieved")

      console.info("Getting 'merch' collection...")
      db.collection('merch', (merchError, merch) => {
        if(merchError) throw merchError
        if(merch) console.info("'merch' collection retrieved")

        console.info("Getting 'projects' collection...")
        db.collection('projects', (projectsError, projects) => {
          if(projectsError) throw projectsError
          if(projects) console.info("'projects' collection retrieved")

          console.info("Getting 'singles' collection...")
          db.collection('singles', (singlesError, singles) => {
            if(singlesError) throw singlesError
            if(singles) console.info("'singles' collection retrieved")

            console.info("Getting 'videos' collection...")
            db.collection('videos', (videosError, videos) => {
              if(videosError) throw videosError
              if(videos) console.info("'videos' collection retrieved")

              // Dead home path
              app.use('/', (req, res, next) => {
                next()
              })
              
              // Proper path handling
              // Beats
              app.route('/beats')
                .get((req, res) => {
                  console.info(`Getting all beats for request from ${req.ip}`);
                  beats.find().toArray((error, result) => {
                    if(error) throw error

                    res.json(result)
                  })
                })
              
              // Credits
              app.route('/credits')
                .get((req, res) => {
                  console.info(`Getting all credits for request from ${req.ip}`);
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
                    console.info(`Getting customer ${customerId}`)
  
                    customersApi.retrieveCustomer(customerId)
                      .then(customerFulfilled => customerFulfilled.result.customer).then(customer => {
                        console.info(`Customer ${customerId} with email ${customer.emailAddress} retrieved`)
                        const customerRetVal = {
                          id: customer.id,
                          firstName: customer.givenName,
                          lastName: customer.familyName,
                          email: customer.emailAddress
                        }
  
                        console.info(printJSON(customerRetVal))
  
                        res.json(customerRetVal)
                      }).catch(customerError => {
                        console.error(`Customer ${customerId} not found.`)
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
                  }).catch(orderError => console.error(orderError))
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
                      console.info(`${emailFulfilled.status} - Code ${code} sent to customer with email ${customer.emailAddress}`)
                      const response = {
                        id: customer.id,
                        firstName: customer.givenName,
                        lastName: customer.familyName,
                        email: customer.emailAddress
                      }
                      console.info(`Customer Retrieved via email:\n${printJSON(response)}`)
  
                      res.json(response)
                    }).catch(emailError => {
                      console.error(`Error emailing order confirmation email to customer with email ${customer.emailAddress}`)
                      const exception = {
                        status: 500,
                        message: `Internal Server Error`,
                        data: emailError,
                        code: EMAILJS_ERROR
                      }

                      console.error(printJSON(exception))
                      res.status(exception.status).json(exception)
                    })
                  }).catch(customersError => console.info(customersError))
                })

              // Merchandise
              app.route('/merch')
                .get((req, res) => {
                  console.info(`Getting all merch for request from ${req.ip}`);
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

                    console.info('Loading cart and calculating price and weight')
                    for (let item of cart) {
                      try {
                        const merchItem = await merch.findOne({id: item.merchId})
  
                        const itemSize = item.sizeId && merchItem.sizes
                          ? merchItem.sizes.find(size => size.id === item.sizeId)
                          : undefined
  
                        if((itemSize && itemSize.quantity < item.quantity) || merchItem.quantity < item.quantity) {
                          const itemQuantity = itemSize ? itemSize.quantity : merchItem.quantity
                          console.error(`${merchItem.name}${itemSize ? `(${itemSize.name})` : ``} has less in stock than the requested amount.\nRequested Amount: ${item.quantity}\nAmount In Stock: ${itemQuantity}`)
  
                          throw {
                            status: 400,
                            message: `${merchItem.name}${itemSize ? `(${itemSize.name})` : ``} has less in stock than the requested amount.`,
                            data: {
                              mechId: merchItem.id,
                              name: `${merchItem.name}${itemSize ? `(${itemSize.name})` : ``}`,
                              request: item.quantity,
                              stock: itemQuantity
                            },
                            code: TOO_MANY
                          }
                        } else if ((itemSize && itemSize.quantity === 0) || merchItem.quantity === 0) {
                          console.error(`${merchItem.name}${itemSize ? `(${itemSize.name})` : ``} is sold out.`)
  
                          throw {
                            status: 400,
                            message: `${merchItem.name}${itemSize ? `(${itemSize.name})` : ``} is sold out.`,
                            data: {
                              mechId: merchItem.id,
                              name: `${merchItem.name}${itemSize ? `(${itemSize.name})` : ``}`,
                              request: item.quantity,
                              stock: 0
                            },
                            code: SOLD_OUT
                          }
                        } else {
                          const itemPrice = itemSize ? itemSize.price : merchItem.price
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
                        }
                      } catch (merchFindError) {
                        if(merchFindError.code === SOLD_OUT || merchFindError.code === TOO_MANY) {
                          throw merchFindError
                        } else {
                          console.error(`Merch item ${item.merchId} not found`)
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
                        carrier_id: "se-637975",
                        service_code: "usps_first_class_mail",
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
                          address_line1: "903 SE Brick Ave",
                          address_line2: "Apt. 205",
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
                  
                        const trackableRates = rates.filter((rate) => rate.trackable === true)
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
                            amount: shippingRate * 100,
                            currency: 'USD',
                          },
                          name: 'Shipping',
                          uid: 'shipping'
                        })
                  
                        console.info(`Creating Order for user with email ${email}`)
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
                        console.info(`Order created: ${printJSON(order)}`)
                
                        orderId = order.id
                        orderVersion = order.version
                        console.info(`Creating Payment for Order with id ${orderId}`)
                
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
                        console.info(`Payment Created: ${printJSON(payment)}`)
                
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
                
                        console.info(`Sending order response: ${printJSON(response)}`)
                        return response
                      }
                    } catch (e) {
                      if (e.errors) {
                        if (orderId) {
                          console.error(`Error in creating payment for order ${orderId} with email ${email}.`)
                          console.error(printJSON(e.errors))
                          const exception = {
                            status: 500,
                            message: `Server error creating payment for order ${orderId} with email ${email}.`,
                            data: e.errors,
                            code: PAYMENTS_API_ERROR
                          }

                          console.error(printJSON(exception))
                          res.status(exception.status).json(exception)

                          ordersApi.updateOrder(orderId, {
                            order: {
                              locationId: process.env.SQUARE_LOC_ID,
                              state: 'CANCELED',
                              version: orderVersion
                            }
                          }).then(orderFulfilled => orderFulfilled.result.order).then(order => {
                            console.info(`Removed order ${orderId} because of payment error`)
                          }).catch(orderError => {
                            console.error(`Error canceling order ${orderId} after payment failure.`)
                            console.error(printJSON(orderError))
                          })
                        } else {
                          console.error(`Error in creating order for customer with email ${email}.`)
                          console.error(printJSON(e.errors))
                          const exception = {
                            status: 500,
                            message: `Server error in creating order for customer with email ${email}.`,
                            data: e.errors,
                            code: ORDERS_API_ERROR
                          }

                          throw exception
                        }
                      } else if(e.response) {
                        console.error("Error in the ShipEngine API")
                        if (e.response.status === 400 && e.response.data.errors[0].error_type === "validation") {
                          const exception = {
                            status: 400,
                            message: `Error creating a rate for order for customer ${customer.id}`,
                            data: e.response.data.errors,
                            code: SHIPPING_RATE_ERROR
                          }

                          throw exception
                        } else {
                          console.error(e.response.data.errors)
                          throw {
                            status: 500,
                            message: `Error in the ShipEngine API`,
                            data: e.response.data.errors,
                            code: SHIPPING_RATE_ERROR
                          }
                        }
                      }
                    }
                  }

                  console.info(`New Order Request: ${printJSON(req.body)}`)

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

                  console.info(`Retrieving customer with email ${email}`)
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
                      console.info(`Creating a new customer for ${firstName} ${lastName} with email ${email}`)
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
                        console.info(`Customer created in Square: ${printJSON(customer)}`)
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
                          console.info(`Customer card created: ${printJSON(card)}`)

                          placeOrder(customer, card ? card.id : token, req.body)
                            .then(orderInfo => {

                              console.info(`Sending order response: ${printJSON(orderInfo)}`)
                              res.json(orderInfo)

                              console.info(`Emailing confirmation to customer for order ${orderInfo.orderId} to email ${customer.emailAddress}`)
                              axios.post('https://api.emailjs.com/api/v1.0/email/send', {
                                service_id: process.env.EMAILJS_SERVICE,
                                template_id: process.env.EMAILJS_ORDER_TEMPLATE,
                                user_id: process.env.EMAILJS_ID,
                                accessToken: process.env.EMAILJS_TOKEN,
                                template_params: {
                                  first_name: orderInfo.customer.firstName,
                                  order: orderInfo.id,
                                  email: orderInfo.customer.email
                                }
                              }, {
                                headers: {
                                  "Content-Type": "application/json",
                                  "Host": "api.emailjs.com"
                                }
                              }).then(emailFulfilled => console.info(`${emailFulfilled.status} - Order confirmation email sent to customer with email ${customer.emailAddress}`))
                              .catch(emailError => {
                                console.error(`Error emailing order confirmation email to customer with email ${customer.emailAddress}`)
                                if (emailError.response) {
                                  console.error(printJSON(emailError.response.data))
                                } else if (emailError.request) {
                                  console.error(printJSON(emailError.request))
                                } else {
                                  console.error(printJSON(emailError.message))
                                }
                              })
                            }).catch(orderCompletionError => {
                              console.error(orderCompletionError)

                              res.status(orderCompletionError.status).json(orderCompletionError)
                            })
                        }).catch(cardError => {
                          console.error(`Error creating card for customer ${customer.id}`)
                          const exception = {
                            status: 400,
                            message: `Error creating card for customer ${customer.id}`,
                            data: cardError.errors,
                            code: CARDS_API_ERROR
                          }

                          console.error(printJSON(exception))
                          res.status(exception.status).json(exception)
                        })
                      }).catch(customerError => {
                        console.error(`Error creating customer with email ${email}`)
                        const exception = {
                          status: 400,
                          message: `Error creating customer with email ${email}`,
                          data: customerError.errors,
                          code: CUSTOMERS_API_ERROR
                        }

                        console.error(printJSON(exception))
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
                        console.info(`Customer card created: ${printJSON(card)}`)

                        placeOrder(customer, card ? card.id : token, req.body)
                          .then(orderInfo => {
                            console.info(`Emailing confirmation to customer for order ${orderInfo.orderId} to email ${customer.emailAddress}`)
                            res.json(orderInfo)

                            axios.post('https://api.emailjs.com/api/v1.0/email/send', {
                              service_id: process.env.EMAILJS_SERVICE,
                              template_id: process.env.EMAILJS_ORDER_TEMPLATE,
                              user_id: process.env.EMAILJS_ID,
                              accessToken: process.env.EMAILJS_TOKEN,
                              template_params: {
                                first_name: orderInfo.customer.firstName,
                                order: orderInfo.id,
                                email: orderInfo.customer.email
                              }
                            }, {
                              headers: {
                                "Content-Type": "application/json",
                                "Host": "api.emailjs.com"
                              }
                            }).then(emailFulfilled => console.info(`${emailFulfilled.status} - Order confirmation email sent to customer with email ${customer.emailAddress}`))
                            .catch(emailError => {
                              console.error(`Error emailing order confirmation email to customer with email ${customer.emailAddress}`)
                              console.error(emailError.toJSON())
                            })
                          }).catch(orderError => {
                            console.error(orderError)

                            res.status(orderError.status).json(orderError)
                          })
                      }).catch(cardError => {
                        console.error(`Error creating card for customer ${customer.id}`)
                        const exception = {
                          status: 400,
                          message: `Error creating card for customer ${customer.id}`,
                          data: cardError.errors,
                          code: CUSTOMERS_API_ERROR
                        }

                        console.error(printJSON(exception))
                        res.status(exception.status).json(exception)
                      })
                    }
                  }).catch(customerError => {
                    console.error(`Error retrieving customer with email ${email}`)
                    console.error(printJSON(customerError))

                    res.status(500).json({
                      status: 500,
                      message: `Error retrieving customer with email ${email}`,
                      data: customerError,
                      code: CUSTOMERS_API_ERROR
                    })
                  })
                })
                .get((req, res) => {
                  console.info(`Getting all orders`)

                  const { ordersApi } = squareClient

                  ordersApi.searchOrders({
                    returnEntries: false,
                    locationIds: [process.env.SQUARE_LOC_ID]
                  }).then(ordersFulfilled => ordersFulfilled.result.orders).then(orders => {
                    console.info(`${orders.length} orders retrieved`)
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
                        createdDate: new Date(order.createdAt)
                      })
                    }

                    res.json(result)
                  }).catch(ordersError => {
                    console.error(`Error retrieving all orders`)
                    const exception = {
                      status: 500,
                      message: `Internal error retrieving all orders from Square.`,
                      data: ordersError.errors,
                      code: ORDERS_API_ERROR
                    }

                    console.error(printJSON(exception))
                    res.status(exception.status).json(exception)
                  })
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
                    console.info(`${orders.length} open orders. Completing payments and creating shipping labels.`)
                    const completeOrders = async () => {
                      let completedOrders = []
                      for(let order of orders) {
                        try {
                          const completedOrder = await completeOrder(order)
                          completedOrders.push(completedOrder)
                        } catch (orderCompletionError) {
                          throw orderCompletionError
                        }

                        customersApi.retrieveCustomer(order.customerId)
                          .then(customerFulfilled => customerFulfilled.result.customer).then(customer => {
                              console.info(`Emailing customer for order ${order.id} to email ${customer.emailAddress}`)
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
                              }).then(emailFulfilled => console.info(`${emailFulfilled.status} - Order completion email sent to customer with email ${customer.emailAddress}`))
                              .catch(emailError => {
                                console.error(`Error emailing order completion email to customer with email ${customer.emailAddress}`)
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
                            }

                            console.error(`Error retrieving customer ${order.customerId}`)
                            const exception = {
                              status: 400,
                              message: `Error finding customer ${order.customerId}`,
                              data: customerError.errors,
                              code: CUSTOMERS_API_ERROR
                            }

                            throw exception
                          })
                      }

                      return completedOrders
                    }

                    completeOrders().then(completedOrders => {
                      console.info(`Completed ${completedOrders.length} payments`)
                      console.info(printJSON(completedOrders))

                      res.json(completedOrders)
                    }).catch(orderCompletionError => {
                      console.error(printJSON(orderCompletionError))

                      res.status(orderCompletionError.status).json(orderCompletionError)
                    })
                  }).catch(ordersError => {
                    console.error(`Error retrieving open orders`)
                    const exception = {
                      status: 500,
                      message: `Internal error retrieving open orders from Square.`,
                      data: ordersError.errors,
                      code: ORDERS_API_ERROR
                    }

                    console.error(printJSON(exception))
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
                          console.error(`Error getting shipping label with url ${url}`)
                          console.error(e)
                        }
                        
                      }

                      const mergedPdfBuffer = await mergedPdf.save()
                      
                      res.header('Content-Type', 'application/pdf')
                      res.send(Buffer.from(mergedPdfBuffer))
                    } catch(e) {
                      console.error(`Error merging shipping labels`)
                      const exception = {
                        status: 400,
                        message: `Error merging shipping labels`,
                        data: {
                          error: e,
                          success: false
                        },
                        code: SERVER_ERROR
                      }
                      console.error(printJSON(exception))

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
                        console.error(`Order ${orderId} not found`)
                        const exception = {
                          status: 404,
                          message: `Order ${orderId} not found`,
                          data: {
                            orderId: orderId
                          },
                          code: NOT_FOUND
                        }

                        console.error(printJSON(exception))
                        res.status(exception.status).json(exception)
                      } else {
                        console.info(`Found order ${order.id}.`)

                        if (order.state === 'COMPLETED' || order.state === 'CANCELED') {
                          console.error(`Order ${order.id} is in state ${order.state}, and cannot be updated.`)
                          const exception = {
                            status: 400,
                            message: `Order ${orderId} not found`,
                            data: {
                              orderId: order.id,
                              state: order.state
                            },
                            code: BAD_REQUEST
                          }

                          console.error(printJSON(exception))
                          res.status(exception.status).json(exception)
                        } else {
                          console.info(`Canceling order ${orderId}...`)

                          ordersApi.updateOrder(order.id, {
                            order: {
                              version: order.version,
                              locationId: process.env.SQUARE_LOC_ID,
                              state: 'CANCELED'
                            }
                          }).then(canceledResult => canceledResult.result.order).then(canceledOrder => {
                            if(!canceledOrder) {
                              console.error(`Error canceling order. Might need to be done manually.`)
                              const exception = {
                                status: 500,
                                message: `Error canceling order. Might need to be done manually.`,
                                data: {
                                  orderId: order.id
                                },
                                code: SERVER_ERROR
                              }

                              console.error(printJSON(exception))
                              res.status(exception.status).json(exception)
                            } else {
                              console.info(`Order ${canceledOrder.id} canceled.`)

                              res.status(204).send()

                              const customerId = canceledOrder.customerId
                              if (!customerId) {
                                console.warn(`No customer associated with order ${canceledOrder.id}. Cannot send cancelation email.`)
                              } else {
                                console.info(`Finding customer for order ${canceledOrder.id}`)
                                customersApi.retrieveCustomer(customerId)
                                  .then(customerFound => customerFound.result.customer).then(customer => {
                                    if(!customer) {
                                      console.warn(`Customer ${customerId} not found. Not sending cancelation email.`)
                                    } else {
                                      console.info(`Sending cancelation confirmation email to customer with email ${customer.emailAddress}`)

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
                                      }).then(emailFulfilled => console.info(`${emailFulfilled.status} - Cancelation confirmation email sent to customer with email ${customer.emailAddress}`))
                                      .catch(emailError => {
                                        console.error(`Error emailing order confirmation email to customer with email ${customer.emailAddress}`)
                                        console.error(emailError.toJSON())
                                      })
                                    }
                                  }).catch(customerFindError => {
                                    console.error(`Error in finding customer ${customerId}.`)
                                    console.error(customerFindError.errors)
                                  })
                              }
                            }
                          }).catch(orderUpdateError => {
                            console.error(`Error in canceling order ${orderId}.`)
                            const exception = {
                              status: 400,
                              message: `Server error in canceling order ${orderId}.`,
                              data: orderUpdateError.errors,
                              code: ORDERS_API_ERROR
                            }
                            
                            console.error(printJSON(exception))
                            res.status(exception.status).json(exception)
                          })
                        }
                      }
                    }).catch(orderFindError => {
                      console.error(`Error in finding order ${orderId}.`)
                      const exception = {
                        status: 400,
                        message: `Server error in finding order ${orderId}.`,
                        data: orderFindError.errors,
                        code: ORDERS_API_ERROR
                      }
                      
                      console.error(printJSON(exception))
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
                        console.info(`Completed order ${completedOrder.id}`)
                        console.info(printJSON(completedOrder))

                        res.json(JSON.parse(printJSON(completedOrder)))

                        customersApi.retrieveCustomer(order.customerId)
                          .then(customerFulfilled => customerFulfilled.result.customer).then(customer => {
                            console.info(`Emailing customer for order ${order.id} to email ${customer.emailAddress}`)
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
                            }).then(emailFulfilled => console.info(`${emailFulfilled.status} - Order completion email sent to customer with email ${customer.emailAddress}`))
                            .catch(emailError => {
                              console.error(`Error emailing order completion email to customer with email ${customer.emailAddress}`)
                              console.error(emailError.toJSON())
                            })
                          }).catch(customerRejected => console.error(customerRejected))
                      }).catch(orderCompletionError => {
                        console.error(printJSON(orderCompletionError))

                        res.status(orderCompletionError.status).json(orderCompletionError)
                      })
                    }).catch(orderError => {
                      console.error(`Error retrieving order ${orderId} from Square`)
                      const exception = {
                        status: 400,
                        message: `Error retrieving order ${orderId} from Square`,
                        data: orderError,
                        code: ORDERS_API_ERROR
                      }

                      console.error(printJSON(exception))
                      res.status(exception.status).json(exception)
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
                    carrier_ids: ["se-637975"]
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

                      const trackableRates = rates.filter((rate) => rate.trackable === true && rate.service_code === "usps_first_class_mail")
                      let lowestRate = trackableRates[0]
                      for(let rate of trackableRates) {
                        if(rate.shipping_amount.amount < lowestRate.shipping_amount.amount) {
                          lowestRate = rate
                        }
                      }

                      console.info(`Estimated rate for ${postalCode}: $${lowestRate.shipping_amount.amount}`)

                      res.status(200).json({
                        rate: lowestRate.shipping_amount.amount,
                      })
                    }
                    else {
                      res.status(400).json(JSON.parse(rateFulfilled.body))
                    }

                  }).catch((ratesError) => {
                    if (ratesError.response) {
                      if(ratesError.status === 400) {
                        console.error(`Bad request when estimating rate`)
                        const exception = {
                          status: 400,
                          message: `Bad request when estimating rate`,
                          data: ratesError.response,
                          code: SHIPPING_RATE_ERROR
                        }

                        console.error(printJSON(exception))
                        res.status(exception.status.json(exception))
                      } else {
                        console.error(`ShipEngine Error`)
                        const exception = {
                          status: ratesError.status,
                          message: `ShipEngine Error`,
                          data: ratesError.response,
                          code: SHIPENGINE_ERROR
                        }

                        console.error(printJSON(exception))
                        res.status(exception.status).json(exception)
                      }
                    } else {
                      console.error(`Internal Server Error.`)
                      const exception = {
                        status: 500,
                        message: `Internal Server Error.`,
                        data: ratesError,
                        code: SERVER_ERROR
                      }

                      console.error(printJSON(exception))
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
                      console.info(`Getting all beat tapes for request from ${req.ip}`);
                      projects.find({ beatTape: true }).toArray((error, result) => {
                        if(error) throw error
                        res.json(result)
                      })
                      break;
                    // Return only Albums
                    case 'false': 
                      console.info(`Getting all albums for request from ${req.ip}`);
                      projects.find({ beatTape: false }).toArray((error, result) => {
                        if(error) throw error
                
                        res.json(result)
                      })
                      break;
                    // Return all Projects
                    default: 
                      console.info(`Getting all projects for request from ${req.ip}`);
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
                  console.info(`Getting all singles for request from ${req.ip}`);
                  singles.find().toArray((error, result) => {
                    if(error) throw error

                    res.json(result)
                  })
                })

              // Videos
              app.route('/videos')
                .get((req, res) => {
                  console.info(`Getting all videos for request from ${req.ip}`);
                  videos.find().toArray((error, result) => {
                    if(error) throw error

                    res.json(result)
                  })
                })
              
              // Listener
              app.listen(port, () => {
                console.info(`The ZaePI is listening on port ${port}!`)
              })
            })
          })
        })
      })
    })
  })
})