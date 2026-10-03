'use strict';

const EventEmitter = require('events');

class EvidenceGuardEventBus extends EventEmitter {}

const eventBus = new EvidenceGuardEventBus();
eventBus.setMaxListeners(50);

module.exports = eventBus;
