const https = require('node:https');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const cloudwatch = new CloudWatchClient({});

function check() {
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: process.env.ENDPOINT, path: '/api/ready', timeout: 8000, agent: false }, response => {
      let body = '';
      const certificate = response.socket.getPeerX509Certificate();
      const daysLeft = certificate ? (Date.parse(certificate.validTo) - Date.now()) / 86400000 : 0;
      response.on('data', chunk => { body += chunk; if (body.length > 8192) request.destroy(new Error('Response too large')); });
      response.on('end', () => {
        try { resolve({ healthy: response.statusCode === 200 && JSON.parse(body).status === 'ok' && daysLeft > 2, daysLeft }); }
        catch { reject(new Error('Invalid readiness response')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Endpoint timed out')));
    request.on('error', reject);
  });
}

exports.handler = async () => {
  let result = { healthy: false, daysLeft: 0 };
  let reason = 'ok';
  try { result = await check(); if (!result.healthy) reason = 'readiness_or_certificate'; }
  catch (error) { reason = error.code || error.name || 'check_failed'; }
  await cloudwatch.send(new PutMetricDataCommand({ Namespace: 'Bayline', MetricData: [{
    MetricName: 'Healthy', Dimensions: [{ Name: 'App', Value: 'Bayline' }], Value: result.healthy ? 1 : 0, Unit: 'Count',
  }] }));
  console.log(JSON.stringify({ event: 'uptime_check', healthy: result.healthy, certificate_days_left: Number.isFinite(result.daysLeft) ? Math.round(result.daysLeft * 100) / 100 : 0, reason }));
  return result;
};
