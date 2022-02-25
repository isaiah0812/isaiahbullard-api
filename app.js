require('dotenv').config()

const express = require('express')
const app = express()
const cors = require('cors')
const emailjs = require('emailjs-com')

const port = 8080

const logger = require('./utils/logger');

app.use(express.json())
app.use(cors({
  origin: "*",
  credentials: true
}))

emailjs.init(process.env.EMAILJS_ID)

const main = async () => {
  try {
    await require('./mongo/setup').connectDb();

    // Dead home path
    app.use('/', (req, res, next) => {
      next()
    })
    
    // Proper path handling
    app.use('/beats', require('./beats'));
    app.use('/credits', require('./credits'));
    app.use('/customers', require('./customers'));
    app.use('/merch', require('./merch'));
    app.use('/orders', require('./orders'));
    app.use('/projects', require('./projects'));
    app.use('/singles', require('./singles'));
    app.use('/videos', require('./videos'));
    
    // Health Check
    /**
     * TODO:
     * - check collection connections and add status report
     * - return response body
     */
    app.route('/health')
      .get((req, res) => res.status(200).send());

    // Listener
    app.listen(port, () => {
      logger.info(`The ZaePI is listening on port ${port}!`)
    })
  } catch (err) {
    throw err;
  }
}

main();