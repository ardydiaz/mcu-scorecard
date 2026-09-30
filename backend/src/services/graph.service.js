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

// Fetches every user in the tenant, following @odata.nextLink pages
async function listAllUsers() {
  const client = await getAppGraphClient();
  const users = [];
  let response = await client
    .api('/users')
    .select('id,displayName,mail,userPrincipalName,jobTitle,department,accountEnabled')
    .top(999)
    .get();

  users.push(...response.value);
  while (response['@odata.nextLink']) {
    response = await client.api(response['@odata.nextLink']).get();
    users.push(...response.value);
  }
  return users;
}

module.exports = { getAppGraphClient, getUserProfile, listAllUsers };
