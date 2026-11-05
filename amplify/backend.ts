import { defineBackend } from '@aws-amplify/backend';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { orders } from './functions/orders/resource';

const backend = defineBackend({ auth, data, orders });

// Every signed-in user can read and write restaurant data, so accounts are
// created by an administrator rather than through public sign-up.
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// The orders function writes Order, KitchenTicket, GuestCheck and Seating in one
// DynamoDB transaction, which the data API cannot do.
const { tables } = backend.data.resources;
const tableAccess = {
  DiningTable: ['dynamodb:GetItem', 'dynamodb:Query'],
  MenuItem: ['dynamodb:BatchGetItem'],
  Order: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
  KitchenTicket: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
  GuestCheck: ['dynamodb:PutItem'],
  Seating: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:ConditionCheckItem'],
};
const statements = Object.entries(tableAccess).map(([model, actions]) => {
  const table = tables[model];
  backend.orders.addEnvironment(`${model.toUpperCase()}_TABLE`, table.tableName);
  return new PolicyStatement({
    actions,
    resources: [table.tableArn, `${table.tableArn}/index/*`],
  });
});
backend.orders.resources.lambda.role?.attachInlinePolicy(
  new Policy(backend.orders.stack, 'OrdersTableAccess', { statements }),
);
