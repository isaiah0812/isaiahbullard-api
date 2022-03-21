import { Client, Environment } from 'square';

require('dotenv').config();

export const client = new Client({
  environment: 
    process.env.NODE_ENV === 'LOCAL' || process.env.NODE_ENV === 'TEST'
      ? Environment.Sandbox 
      : Environment.Production,
  accessToken: process.env.SQUARE_ACCESS_TOKEN
});
