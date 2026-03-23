import { Payments } from '@nevermined-io/payments';
import { paymentMiddleware } from '@nevermined-io/payments/express';

export function createPaymentsService(config) {
  if (!config.nvmApiKey) {
    return {
      payments: null,
      middleware: null,
      enabled: false,
    };
  }

  const payments = Payments.getInstance({
    nvmApiKey: config.nvmApiKey,
    environment: config.nvmEnv,
  });

  const middleware = config.nvmPlanId
    ? paymentMiddleware(
        payments,
        {
          'GET /research': {
            planId: config.nvmPlanId,
            ...(config.nvmAgentId && { agentId: config.nvmAgentId }),
            credits: 1,
          },
          'GET /fetch': {
            planId: config.nvmPlanId,
            ...(config.nvmAgentId && { agentId: config.nvmAgentId }),
            credits: 1,
          },
        },
        {
          onBeforeVerify: (req) =>
            console.log(`[NVM] Verifying ${req.method} ${req.path}`),
          onAfterSettle: (req, credits) =>
            console.log(`[NVM] Settled ${credits} credits for ${req.path}`),
          onPaymentError: (error, req, res) => {
            console.error(`[NVM] Payment error: ${error.message}`);
            res.status(402).json({
              error: 'Payment required',
              checkout: `https://nevermined.app/checkout/plan/${config.nvmPlanId}`,
            });
          },
        }
      )
    : null;

  return {
    payments,
    middleware,
    enabled: Boolean(middleware),
  };
}
