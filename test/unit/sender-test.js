'use strict';

const Dgram = require('dgram');
const EventEmitter = require('events').EventEmitter;
const Sender = require('../../src/sender').Sender;
const Sinon = require('sinon');

const anyPort = 1234;
const anyIpv4 = '1.2.3.4';
const anyIpv6 = '2002:20:0:0:0:0:1:3';
const anyRequest = new Buffer(0x02);
const udpIpv4 = 'udp4';
const udpIpv6 = 'udp6';

class SocketStub extends EventEmitter {
  constructor(sendSuccess) {
    super();
    this.sendSuccess = sendSuccess;
    this.validationData = {};
  }

  send(buffer, offset, length, port, ipAddress) {
    this.validationData.buffer = buffer;
    this.validationData.offset = offset;
    this.validationData.port = port;
    this.validationData.ipAddress = ipAddress;

    process.nextTick(this.responseHandler.bind(this));
  }

  responseHandler() {
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

const sendToIpAddressImpl = function(test, sinon, ipAddress, udpVersionExpected, sendSuccess) {
  sinon.stub(Dgram, 'createSocket').withArgs(udpVersionExpected).returns(new SocketStub(sendSuccess));

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

    test.strictEqual(socketStub.validationData.buffer, anyRequest);
    test.strictEqual(socketStub.validationData.offset, 0);
    test.strictEqual(socketStub.validationData.port, anyPort);
    test.strictEqual(socketStub.validationData.ipAddress, ipAddress);
    test.strictEqual(socketStub.validationData.closed, true);

    test.done();
  });
};

exports['Sender send to IP address'] = {
  setUp: function(done) {
    this.sinon = Sinon.sandbox.create();
    done();
  },

  tearDown: function(done) {
    this.sinon.restore();
    done();
  },

  'send to IPv4': function(test) {
    sendToIpAddressImpl(test, this.sinon, anyIpv4, udpIpv4, true);
  },

  'send to IPv6': function(test) {
    sendToIpAddressImpl(test, this.sinon, anyIpv6, udpIpv6, true);
  },

  'send fails': function(test) {
    sendToIpAddressImpl(test, this.sinon, anyIpv4, udpIpv4, false);
  },

  'send cancel': function(test) {
    this.sinon.stub(Dgram, 'createSocket').withArgs(udpIpv4).returns(new SocketStub(true));
    const multiSubnetFailover = false;
    const sender = new Sender(anyIpv4, anyPort, anyRequest, multiSubnetFailover);
    sender.execute((error, message) => {
      test.ok(false, 'Should never get here.', error, message);
    });

    sender.cancel();

    test.done();
  }
};
