require('dotenv').config();

const express = require("express");
const axios = require('axios');

const logger = require('../config/logger');
const square = require('../config/square').client;

const router = express.Router();
const printJSON = require('../utils/helpers').printJSON;

const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const {
  EMAILJS_ERROR,
  CUSTOMERS_API_ERROR,
} = require('../constants');

/**
 * TODO:
 * - GET / (get all customers)
 */

router.route('/:customerId')
  .get((req, res, next) => {
    const customerId = req.params.customerId;
    
    if (customerId === 'email') {
      next();
    } else {
      const { customersApi } = square;
      logger.info(`Getting customer ${customerId}`);

      customersApi.retrieveCustomer(customerId)
        .then(customerFulfilled => customerFulfilled.result.customer).then(customer => {
          logger.info(`Customer ${customerId} with email ${customer.emailAddress} retrieved`)
          const customerRetVal = {
            id: customer.id,
            firstName: customer.givenName,
            lastName: customer.familyName,
            email: customer.emailAddress
          };

          logger.info(printJSON(customerRetVal));

          res.json(customerRetVal);
        }).catch(customerError => {
          logger.error(`Customer ${customerId} not found.`)
          throw {
            status: 404,
            message: `Customer ${customerId} not found.`,
            data: customerError.errors,
            code: CUSTOMERS_API_ERROR
          }
        });
    }
  });

router.route('/:customerId/orders')
  .get((req, res) => {
    const { ordersApi } = square
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
  });

router.route('/email')
  .post((req, res) => {
    const { customersApi } = square
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

module.exports = router;