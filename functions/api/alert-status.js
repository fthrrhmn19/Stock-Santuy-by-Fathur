import { onRequest as alertCheck } from './alert-check.js';

export async function onRequest(context) {
  return alertCheck(context);
};
