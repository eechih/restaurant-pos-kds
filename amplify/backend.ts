import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

const backend = defineBackend({ auth, data });

// Every signed-in user can read and write restaurant data, so accounts are
// created by an administrator rather than through public sign-up.
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};
