'use strict';

const Dgram = require('dgram');
const EventEmitter = require('events').EventEmitter;
const Sender = require('../../src/sender').Sender;
const Sinon = require('sinon');

const anyPort = 1234;
const anyIpv4 = '1.2.3.4';
const anyIpv6 = '2002:20:0:0:0:0:1:3';
const anyRequest = new Buffer(0x02);

class SocketStub extends EventEmitter {
  constructor(udpVersion, sendSuccess) {
    super();
    this.sendSuccess = sendSuccess;
    this.validationData = {};
    this.validationData.udpVersion = udpVersion;
  }

  send(buffer, offset, length, port, ipAddress) {
    this.validationData.buffer = buffer;
    this.validationData.offset = offset;
    this.validationData.port = port;
    this.validationData.ipAddress = ipAddress;

    if (this.sendSuccess) {
      this.emit('message', this);
    } else {
      this.emit('error', this);
    }
  }

  close() {
    this.validationData.closed = true;
  }
}

const senderIpAddressImpl = function(test, sinon, ipAddress, udpVersionExpected, sendSuccess) {
  // TODO: Try using constructor directly instead.
  const myCreateSocket = function(udpVersion) {
    return new SocketStub(udpVersion, sendSuccess);
  };

  sinon.stub(Dgram, 'createSocket', myCreateSocket);

  const multiSubnetFailover = false;
  const sender = new Sender(ipAddress, anyPort, anyRequest, multiSubnetFailover);
  sender.execute((error, message) => {
    let socketStub;
    if (sendSuccess) {
      test.strictEqual(error, null);
      test.ok(message instanceof SocketStub);
      socketStub = message;
    } else {
      test.strictEqual(message, undefined);
      test.ok(error instanceof SocketStub);
      socketStub = error;
    }

    test.strictEqual(socketStub.validationData.udpVersion, udpVersionExpected);
    test.strictEqual(socketStub.validationData.buffer, anyRequest);
    test.strictEqual(socketStub.validationData.offset, 0);
    test.strictEqual(socketStub.validationData.port, anyPort);
    test.strictEqual(socketStub.validationData.ipAddress, ipAddress);
    test.strictEqual(socketStub.validationData.closed, true);

    test.done();
  });
};

exports['Sender IP Address'] = {
  setUp: function(done) {
    this.sinon = Sinon.sandbox.create();
    done();
  },

  tearDown: function(done) {
    this.sinon.restore();
    done();
  },

  'connects directly if given an IP v4 address': function(test) {
    senderIpAddressImpl(test, this.sinon, anyIpv4, 'udp4', true);
  },

  'connects directly if given an IP v6 address': function(test) {
    senderIpAddressImpl(test, this.sinon, anyIpv6, 'udp6', true);
  },

  'send fails': function(test) {
    senderIpAddressImpl(test, this.sinon, anyIpv4, 'udp4', false);
  }
};
