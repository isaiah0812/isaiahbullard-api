import { auth, requiredScopes } from 'express-oauth2-jwt-bearer';

export const checkJwt = auth({
  audience: 'https://zaepi/api',
  issuerBaseURL: `https://zaemadethis-dev.us.auth0.com`,
});

export const scopes = {
  readOrders: requiredScopes('read:orders'),
  cancelOrders: requiredScopes('delete:orders'),
  createOrders: requiredScopes('write:orders'),
  editOrders: requiredScopes('edit:orders'),
  completeOrders: requiredScopes('complete:orders'),
  readLabels: requiredScopes('read:labels'),
  readEstimate: requiredScopes('read:rate-estimate'),
}
