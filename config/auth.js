const { auth } = require('express-oauth2-jwt-bearer');

const checkJwt = auth({
  audience: 'https://zaepi/api',
  issuerBaseURL: `https://zaemadethis-dev.us.auth0.com`,
})

module.exports = { checkJwt }