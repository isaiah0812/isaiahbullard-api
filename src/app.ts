/**
 * TODO:
 * - Make sure every endpoint returns no matter what.
 * - Make all unsafe requests require OAuth.
 * - USE HYPERMEDIA
 * - Convert to TypeScript.
 */

import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import emailjs from 'emailjs-com';
import { config } from 'dotenv';
const { default: logger } = require('./config/logger')

config();
const app = express();
const port = 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: "*",
  credentials: true
}));

emailjs.init(process.env.EMAILJS_ID as string);

const main = async () => {
  try {
    await require('./db/setup').connectDb();

    // Dead home path
    app.use('/', (req: Request, res: Response, next: NextFunction) => {
      next()
    });
    
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
      .get((req: Request, res: Response) => res.status(200).send());

    // Listener
    app.listen(port, () => {
      logger.info(`The ZaePI is listening on port ${port}!`)
    })
  } catch (err) {
    throw err;
  }
}

main();