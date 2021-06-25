require('dotenv').config()

const express = require('express')
const app = express()
const cors = require('cors')
const { v4: uuid } = require('uuid')
const { Client, Environment } = require('square')
const request = require('request')
const port = 8080

const squareClient = new Client({
  environment: Environment.Sandbox,
  accessToken: process.env.SQUARE_ACCESS_TOKEN
})

app.use(express.json())
app.use(cors({
  origin: "*",
  credentials: true
}))

const MongoClient = require('mongodb')

const url = `mongodb://${process.env.MONGO_URL}`

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

              console.info("Getting 'customers' collection...")
              db.collection('customers', (customersError, customers) => {
                if(customersError) throw customersError
                if(customers) console.info("'customers' collection retrieved")

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
                app.route('/customers/:email')
                  .get((req, res) => {
                    customers.findOne({email: req.params.email}, (error, result) => {
                      if (error) throw error

                      console.info(`Getting Customer with email ${result.email}`)
                      console.info(result)

                      res.json(result)
                    })
                  })
                  .put((req, res) => {
                    const { firstName, lastName, email, squareId, cart } = req.body
                    const { customersApi } = squareClient

                    customersApi.updateCustomer(squareId, {
                      givenName: firstName,
                      familyName: lastName,
                      emailAddress: email
                    }).then(customer => {
                      console.info(`Customer with email ${email} updated in Square`)
                    }).catch(customerError => {
                      console.error(customerError)
                    })

                    customers.updateOne(
                      {email: req.params.email}, 
                      { $set: { 
                        firstName: firstName,
                        lastName: lastName,
                        email: email,
                        cart: cart
                      }},
                      (error, result) => {
                        if (error) throw error

                        res.json(result)
                      })
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
  
                    const { paymentsApi, ordersApi, customersApi } = squareClient
  
                    const {
                      firstName,
                      lastName,
                      cart,
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
  
                    function processOrder(customer, card) {
                      // Mapping cart to line items
                      let lineItems = []
                      for (let item of cart) {
                        lineItems.push({
                          quantity: item.quantity.toString(),
                          basePriceMoney: {
                            amount: (item.price / item.quantity) * 100,
                            currency: 'USD'
                          },
                          name: item.name,
                          uid: item.merchId
                        })
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
                                value: 0.317,
                                unit: "ounce"
                              }
                            }
                          ]
                        }
                      }

                      request("https://api.shipengine.com/v1/rates", {
                        method: 'POST',
                        headers: {
                          "Host": "api.shipengine.com",
                          "API-Key": process.env.SHIPENGINE_KEY,
                          "Content-Type": "application/json"
                        },
                        body: JSON.stringify(body)
                      }, (error, response) => {
                        if (error) throw new Error(error)

                        // console.log(JSON.stringify(JSON.parse(response.body), null, 2))

                        if(Array.isArray(JSON.parse(response.body).rate_response.rates)) {
                          const rates = JSON.parse(response.body).rate_response.rates
    
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
                              currency: 'USD'
                            },
                            name: "Shipping",
                            uid: 'shipping'
                          })
                          
                          console.info(`Creating Order for user with email ${email}`)
                          ordersApi.createOrder({
                            idempotencyKey: uuid(),
                            order: {
                              locationId: process.env.SQUARE_LOC_ID,
                              lineItems: lineItems,
                              customerId: customer ? customer.id : undefined,
                              metadata: {
                                rate_id: lowestRate.rate_id
                              }
                            }
                          }).then((orderFulfilled) => orderFulfilled.result.order).then((order) => {
                            console.info(`Order created: ${JSON.stringify(order, (key, value) => 
                              typeof value === 'bigint'
                                ? value.toString()
                                : value, 2
                            )}`)
      
                            const orderId = order.id
                            console.info(`Creating Payment for Order with id ${orderId}`)
                            paymentsApi.createPayment({
                              sourceId: card ? card.id : token,
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
                            }).then(paymentFulfilled => paymentFulfilled.result.payment).then((payment) => {
                              console.info(`Payment Created: ${JSON.stringify(payment, (key, value) =>
                                typeof value === 'bigint'
                                  ? value.toString()
                                  : value, 2
                              )}`)
      
                              let response = {
                                customer: customer ? {
                                  squareId: customer.id,
                                  email: customer.emailAddress,
                                  firstName: customer.givenName,
                                  lastName: customer.familyName
                                } : {},
                                totalCost: Number.parseInt(payment.totalMoney.amount.toString())/100,
                                shippingRate: shippingRate
                              }
                              
                              console.info(`Saving customer to zaetabase`)
                              const newCustomer = {
                                firstName: firstName,
                                lastName: lastName,
                                email: email,
                                squareId: customer.id,
                                orders: [orderId],
                                cart: [],
                                address: {
                                  line1: shippingLine1,
                                  line2: shippingLine2,
                                  line3: shippingLine3,
                                  city: shippingCity,
                                  state: shippingState,
                                  postalCode: shippingPostalCode
                                }
                              }
    
                              customers.insertOne(newCustomer, (err, result) => {
                                if(err) throw err
                                
                                console.info(`Customer created in DB: ${JSON.stringify(result, (key, value) => 
                                  typeof value === 'bigint'
                                    ? value.toString()
                                    : value, 2
                                )}\n`)
                                response.customer.id = result.insertedId
    
                                console.info(`Sending order response: ${JSON.stringify(response, null, 2)}`)
                                res.json(response)
                              })
    
                            }).catch((paymentRejected) => {
                              console.error(paymentRejected)
      
                              res.status(400).json({
                                status: paymentRejected.statusCode,
                                message: paymentRejected.errors[0].code
                              })
                            })
                          }).catch((orderRejected) => {
                            console.error(orderRejected)
      
                            res.status(400).json({
                              status: orderRejected.statusCode,
                              message: orderRejected.errors[0].code
                            })
                          })
                        } else {
                          res.status(400).json(JSON.parse(response.body))
                        }

                      })
                    }
  
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

                        processOrder(customer, card)
                      }).catch(cardRejected => console.error(cardRejected))
                    }).catch(customerRejected => console.error(customerRejected))
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

                        console.log(`Estimated rate for ${postalCode}: $${lowestRate.shipping_amount.amount}`)
  
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
})