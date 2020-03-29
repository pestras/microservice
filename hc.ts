import { request } from 'http';

let options = {
  timeout: 2000,
  port: process.argv[2] || 3000,
  host: 'localhost',
  path: '/hc'
};

const req = request(options, res => {
  console.info('STATUS:', res.statusCode);
  process.exit(res.statusCode === 200 ? 0 : 1);
});

req.on('error', err => {
  console.error('ERROR:', err);
  process.exit(1)
});