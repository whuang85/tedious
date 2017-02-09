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

const sendResultSuccess = 0;
const sendResultError = 1;
const sendResultCancel = 2;

class FakeSocket extends EventEmitter {
  constructor(result) {
    super();
    this.result = result;
  }

  send(buffer, offset, length, port, ipAddress) {
    process.nextTick(this.responseHandler.bind(this));
  }

  responseHandler() {
    if (this.result === sendResultError) {
      this.emit('error', this);
    } else {
      this.emit('message', this);
    }
  }

  close() {
  }
}

const sendToIpAddressImpl = function(test, sinon, ipAddress, udpVersionExpected, result) {
  const fakeSocket = new FakeSocket(result);
  const socketSendSpy = sinon.spy(fakeSocket, 'send');
  const socketCloseSpy = sinon.spy(fakeSocket, 'close');
  sinon.stub(Dgram, 'createSocket').withArgs(udpVersionExpected).returns(fakeSocket);

  const multiSubnetFailover = false;
  const sender = new Sender(ipAddress, anyPort, anyRequest, multiSubnetFailover);

  sender.execute((error, message) => {
    if (result === sendResultSuccess) {
      test.strictEqual(error, null);
      test.strictEqual(message, fakeSocket);
    } else if (result === sendResultError) {
      test.strictEqual(error, fakeSocket);
      test.strictEqual(message, undefined);
    } else {
      test.ok(false, 'Should never get here.', error, message);
    }

    test.ok(socketCloseSpy.withArgs().calledOnce);
    test.done();
  });

  test.ok(socketSendSpy.withArgs(anyRequest, 0, anyRequest.length, anyPort, ipAddress).calledOnce);

  if (result === sendResultCancel) {
    sender.cancel();
    test.ok(socketCloseSpy.withArgs().calledOnce);
    test.done();
  }
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
    sendToIpAddressImpl(test, this.sinon, anyIpv4, udpIpv4, sendResultSuccess);
  },

  'send to IPv6': function(test) {
    sendToIpAddressImpl(test, this.sinon, anyIpv6, udpIpv6, sendResultSuccess);
  },

  'send fails': function(test) {
    sendToIpAddressImpl(test, this.sinon, anyIpv4, udpIpv4, sendResultError);
  },

  'send cancel': function(test) {
    sendToIpAddressImpl(test, this.sinon, anyIpv4, udpIpv4, sendResultCancel);
  }
};
