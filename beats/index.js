/**
 * TODO: Consider turning beats page into real beat store and move beat tapes.
 * This is for the site, but still.
 */

const express = require("express");
const logger = require('../utils/logger');
const db = require('../mongo/setup').getDb();

const router = express.Router();
const beats = db.collection('beats');

// TODO: POST / (add a beat)
router.route('/')
  .get((req, res) => {
    logger.info(`Getting all beats for request from ${req.ip}`);
    beats.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

/**
 * TODO: 
 * - GET /:beatId (fetch a beat)
 * - PUT /:beatId (update a beat)
 */

module.exports = router;