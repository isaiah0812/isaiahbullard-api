const express = require("express");
const logger = require('../config/logger');
const db = require('../mongo/setup').getDb();

const router = express.Router();
const merch = db.collection('merch');

/**
 * TODO: 
 * - POST / (create new merch)
 */
router.route('/')
  .get((req, res) => {
    // TODO: Add filtering and sorting
    logger.info(`Getting all merch for request from ${req.ip}`);
    merch.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

/**
 * TODO:
 * - GET /:merchId (get merch item)
 * - PUT /:merchId (update merch item)
 * - DELETE /: merchId (delete merch item)
 */

module.exports = router;