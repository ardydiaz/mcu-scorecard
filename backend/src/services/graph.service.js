require('isomorphic-fetch');
const { Client } = require('@microsoft/microsoft-graph-client');
const { getMsalClient, appScopes } = require('../config/microsoft');

// Graph client authenticated as the app itself (client credentials flow)
async function getAppGraphClient() {
  const result = await getMsalClient().acquireTokenByClientCredential({ scopes: appScopes });
  return Client.init({ authProvider: (done) => done(null, result.accessToken) });
}

// Reads one user's profile (including department) by Entra ID object id
async function getUserProfile(oid) {
  const client = await getAppGraphClient();
  return client
    .api(`/users/${oid}`)
    .select('id,displayName,mail,userPrincipalName,jobTitle,department')
    .get();
}


module.exports = { getAppGraphClient, getUserProfile };
