require('dotenv').config()

const express = require('express')
const app = express()
const cors = require('cors')
const { v4: uuid } = require('uuid')
const { Client, Environment } = require('square')
const request = require('request')
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

const url = `mongodb://${process.env.MONGO_URL}`

async function completeOrder(order) {
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

      try {
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
        console.error(`Error updating order ${order.id} with shipping label`)
        console.error(JSON.stringify(e))
      }
    } catch(e) {
      console.error(`Error creating shipping label for order ${order.id}`)
      console.error(e)
    }
  } else {
    console.warn(`No label being created for ${order.id}. Might be an old order or a test order.`)
  }

  for(const tender of order.tenders) {
    try {
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
    } catch(e) {
      console.error(`Error completing payment ${tender.paymentId} for order ${order.id}`)
      console.error(e)
    }
  }

  return completedOrder
}

async function placeOrder(customer, cardToken, orderRequest) {
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
  for (let item of cart) {
    lineItems.push({
      quantity: item.quantity.toString(),
      basePriceMoney: {
        amount: (item.price / item.quantity) * 100,
        currency: 'USD'
      },
      name: `${item.name}${item.size ? ` (${item.size.name})` : ``}`,
      uid: uuid(),
      metadata: {
        id: item.merchId,
        sizeId: item.size ? item.size.id : undefined
      }
    })
    shippingLabelItems.push({
      name: `${item.name}${item.size ? ` (${item.size.name})` : ``}`,
      quantity: item.quantity,
    })
    weight += (item.weight * item.quantity)
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
      try {
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
        console.info(`Order created: ${JSON.stringify(order, (key, value) => 
          typeof value === 'bigint'
            ? value.toString()
            : value, 2
        )}`)

        const orderId = order.id
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
        console.info(`Payment Created: ${JSON.stringify(payment, (key, value) =>
          typeof value === 'bigint'
            ? value.toString()
            : value, 2
        )}`)

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

        console.info(`Sending order response: ${JSON.stringify(response, null, 2)}`)
        return response
      } catch(squareError) {
        console.error("Error in the Square APIs")
        console.error(squareError)
      }
    }
  } catch (shippingRateError) {
    console.error("Error in the ShipEngine API")
    console.error(shippingRateError)
  }
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
  
                        console.info(JSON.stringify(customerRetVal, null, 2))
  
                        res.json(customerRetVal)
                      }).catch(customerRejected => {
                        console.error(`Error retrieving customer ${customerId}`)
                        console.error(customerRejected)
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
                    
                    res.json(JSON.parse(JSON.stringify(response, (key, value) =>
                      typeof value === 'bigint'
                        ? value.toString()
                        : value, 2
                    )))
                  }).catch(orderRejected => console.error(orderRejected))
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
                      console.info(`Customer Retrieved via email:\n${JSON.stringify(response, null, 2)}`)
  
                      res.json(response)
                    }).catch(emailError => {
                      console.error(`Error emailing order confirmation email to customer with email ${customer.emailAddress}`)
                      console.error(emailError.toJSON())
                      res.status(500).json({
                        status: 500,
                        message: "Internal Server Error"
                      })
                    })
                  }).catch(customersRejected => console.info(customersRejected))
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
                  console.info(`New Order Request: ${JSON.stringify(req.body, null, 2)}`)

                  const { customersApi } = squareClient

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
                        console.info(`Customer created in Square: ${JSON.stringify(customer, (key, value) => 
                          typeof value === 'bigint'
                            ? value.toString()
                            : value, 2
                        )}`)
                        customersApi.createCustomerCard(customer.id, {
                          cardNonce: token,
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
                          cardholderName: cardholderName
                        }).then(cardFulfilled => cardFulfilled.result.card).then(card => {
                          console.info(`Customer card created: ${JSON.stringify(card , (key, value) => 
                            typeof value === 'bigint'
                              ? value.toString()
                              : value, 2
                          )}`)

                          placeOrder(customer, card ? card.id : token, req.body)
                            .then(orderInfo => {

                              console.info(`Sending order response: ${JSON.stringify(orderInfo, null, 2)}`)
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
                                console.error(emailError.toJSON())
                              })
                            }).catch(orderError => {
                              console.error(orderError)

                              res.status(orderError.status).json(orderError.body)
                            })
                        }).catch(cardRejected => console.error(cardRejected))
                      }).catch(customerRejected => console.error(customerRejected))
                    } else {
                      const customer = customers[0]

                      customersApi.createCustomerCard(customer.id, {
                        cardNonce: token,
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
                        cardholderName: cardholderName
                      }).then(cardFulfilled => cardFulfilled.result.card).then(card => {
                        console.info(`Customer card created: ${JSON.stringify(card , (key, value) => 
                          typeof value === 'bigint'
                            ? value.toString()
                            : value, 2
                        )}`)

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

                            res.status(orderError.status).json(orderError.body)
                          })
                      }).catch(cardRejected => console.error(cardRejected))
                    }
                  })
                  .catch(customersRejected => console.error(customersRejected))
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
                  }).catch(ordersRejected => console.error(ordersRejected))
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
                    async function completeOrders() {
                      let completedOrders = []
                      for(let order of orders) {
                        const completedOrder = await completeOrder(order)
                        completedOrders.push(completedOrder)

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
                            })
                          .catch(customerRejected => console.error(customerRejected))
                      }

                      return completedOrders
                    }

                    completeOrders().then(completedOrders => {
                      console.info(`Completed ${completedOrders.length} payments`)
                      console.info(JSON.stringify(completedOrders, (key, value) =>
                        typeof value  === 'bigint'
                          ? value.toString()
                          : value, 2
                      ))

                      res.json(JSON.parse(JSON.stringify(completedOrders, (key, value) => 
                        typeof value === 'bigint'
                          ? value.toString()
                          : value, 2
                      )))
                    })
                  }).catch(ordersRejected => console.error(ordersRejected))
                })

              app.route('/orders/merge')
                .post((req, res) => {
                  async function mergeLabels() {
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
                      console.error(e)
                      res.status(400).json({
                        error: e,
                        success: false
                      })
                    }
                  }

                  mergeLabels()
                })

              app.route('/orders/:orderId/complete')
                .post((req, res) => {
                  const { ordersApi, customersApi } = squareClient

                  ordersApi.retrieveOrder(req.params.orderId)
                    .then(orderFulfilled => orderFulfilled.result.order).then(order => {
                      completeOrder(order).then(completedOrder => {
                        console.info(`Completed order ${completedOrder.id}`)
                        console.info(JSON.stringify(completedOrder, (key, value) =>
                          typeof value  === 'bigint'
                            ? value.toString()
                            : value, 2
                        ))

                        res.json(JSON.parse(JSON.stringify(completedOrder, (key, value) => 
                          typeof value === 'bigint'
                            ? value.toString()
                            : value, 2
                        )))

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
                      })
                    }).catch(orderRejected => console.error(orderRejected))
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

                  request("https://api.shipengine.com/v1/rates/estimate", {
                    method: "POST",
                    headers: {
                      "Host": "api.shipengine.com",
                      "API-Key": process.env.SHIPENGINE_KEY,
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify(body)
                  }, (error, response) => {
                    if (error) throw new Error(error)

                    if(Array.isArray(JSON.parse(response.body))) {
                      const rates = JSON.parse(response.body)

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
                      res.status(400).json(JSON.parse(response.body))
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