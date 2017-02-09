'use strict';

const Dgram = require('dgram');
const Sender = require('../../src/sender').Sender;
const ParallelSendStrategy = require('../../src/sender').ParallelSendStrategy;
const SequentialSendStrategy = require('../../src/sender').SequentialSendStrategy;
const Sinon = require('sinon');

const anyPort = 1234;
const anyIpv4 = '1.2.3.4';
const anyIpv6 = '2002:20:0:0:0:0:1:3';
const anyHost = 'myhostname';
const anyRequest = new Buffer(0x02);

const udpIpv4 = 'udp4';
const udpIpv6 = 'udp6';

const sendResultSuccess = 0;
const sendResultError = 1;
const sendResultCancel = 2;

const sendToIpAddressImpl = function(test, sinon, ipAddress, udpVersionExpected, sendResult) {
  const emitEvent = function() {
    if (sendResult === sendResultError) {
      this.emit('error', this);
    } else {
      this.emit('message', this);
    }
  };

  const sendStub = function(buffer, offset, length, port, ipAddress) {
    process.nextTick(emitEvent.bind(this));
  };

  const testSocket = Dgram.createSocket(udpVersionExpected);
  const socketSendStub = sinon.stub(testSocket, 'send', sendStub);
  const socketCloseStub = sinon.stub(testSocket, 'close');
  const socketStub = sinon.stub(Dgram, 'createSocket');
  socketStub.withArgs(udpVersionExpected).returns(testSocket);

  const multiSubnetFailover = false;
  const sender = new Sender(ipAddress, anyPort, anyRequest, multiSubnetFailover);

  sender.execute((error, message) => {
    if (sendResult === sendResultSuccess) {
      test.strictEqual(error, null);
      test.strictEqual(message, testSocket);
    } else if (sendResult === sendResultError) {
      test.strictEqual(error, testSocket);
      test.strictEqual(message, undefined);
    } else {
      test.ok(false, 'Should never get here.');
    }

    test.ok(socketCloseStub.withArgs().calledOnce);
    test.done();
  });

  test.ok(socketStub.calledOnce);
  test.ok(socketSendStub.withArgs(anyRequest, 0, anyRequest.length, anyPort, ipAddress).calledOnce);

  if (sendResult === sendResultCancel) {
    sender.cancel();
    test.ok(socketCloseStub.withArgs().calledOnce);
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

const sendToHostAddressImpl = function(test, sinon, multiSubnetFailover, sendResult) {
  const addresses = [
    { address: '127.0.0.2' },
    { address: '2002:20:0:0:0:0:1:3' },
    { address: '127.0.0.4' }
  ];

  let testStrategy;
  if (multiSubnetFailover) {
    testStrategy = new ParallelSendStrategy(addresses, anyPort, anyRequest);
  } else {
    testStrategy = new SequentialSendStrategy(addresses, anyPort, anyRequest);
  }

  const callback = () => { };
  const strategySendStub = sinon.stub(testStrategy, 'send');
  strategySendStub.withArgs(callback);

  const sender = new Sender(anyHost, anyPort, anyRequest, multiSubnetFailover);

  const lookupAllStub = sinon.stub(sender, 'invokeLookupAll');
  lookupAllStub.callsArgWith(1, null, addresses);

  let createStrategyStub;
  if (multiSubnetFailover) {
    createStrategyStub = sinon.stub(sender, 'createParallelSendStrategy');
  } else {
    createStrategyStub = sinon.stub(sender, 'createSequentialSendStrategy');
  }

  createStrategyStub.withArgs(addresses, anyPort, anyRequest).returns(testStrategy);

  sender.execute(callback);

  if (sendResult === sendResultCancel) {
    const strategyCancelStub = sinon.stub(testStrategy, 'cancel');
    sender.cancel();
    test.ok(strategyCancelStub.calledOnce);
  }

  test.ok(lookupAllStub.calledOnce);
  test.ok(createStrategyStub.calledOnce);
  test.ok(strategySendStub.calledOnce);

  test.done();
};

exports['Sender send to hostname'] = {
  setUp: function(done) {
    this.sinon = Sinon.sandbox.create();
    done();
  },

  tearDown: function(done) {
    this.sinon.restore();
    done();
  },

  'send with MultiSubnetFailover': function(test) {
    const multiSubnetFailover = true;
    sendToHostAddressImpl(test, this.sinon, multiSubnetFailover, sendResultSuccess);
  },

  'send with MultiSubnetFailover cancel': function(test) {
    const multiSubnetFailover = true;
    sendToHostAddressImpl(test, this.sinon, multiSubnetFailover, sendResultCancel);
  },

  'send without MultiSubnetFailover': function(test) {
    const multiSubnetFailover = false;
    sendToHostAddressImpl(test, this.sinon, multiSubnetFailover, sendResultSuccess);
  },

  'send without MultiSubnetFailover cancel': function(test) {
    const multiSubnetFailover = false;
    sendToHostAddressImpl(test, this.sinon, multiSubnetFailover, sendResultCancel);
  }
};
