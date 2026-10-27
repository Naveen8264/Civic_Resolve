const { EventEmitter } = require('events');
const { log } = require('./logger');
const bus = new EventEmitter();
// Listeners keep logging separate from business logic.
bus.on('complaint:created', (c) => log('INFO', `created ${c.referenceNumber} -> ${c.department} (${c.priority})`));
bus.on('status:updated', (c, from) => log('INFO', `${c.referenceNumber}: ${from} -> ${c.status}`));
bus.on('request:error', (msg) => log('ERROR', msg));
module.exports = bus;
