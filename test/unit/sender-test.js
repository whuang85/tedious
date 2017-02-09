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

// Implementation for testing all variations of sending a message to IP address.
const sendToIpAddressImpl = function(test, sinon, ipAddress, udpVersionExpected, sendResult) {
  // Stub function to mimic socket emitting 'error' and 'message' events.
  const emitEvent = function() {
    if (sendResult === sendResultError) {
      this.emit('error', this);
    } else {
      this.emit('message', this);
    }
  };

  // Stub function to mimic socket 'send' without causing network activity.
  const sendStub = function(buffer, offset, length, port, ipAddress) {
    process.nextTick(emitEvent.bind(this));
  };

  // Create socket exactly like the Sender class would create while stubbing
  // some methods for unit testing.
  const testSocket = Dgram.createSocket(udpVersionExpected);
  const socketSendStub = sinon.stub(testSocket, 'send', sendStub);
  const socketCloseStub = sinon.stub(testSocket, 'close');

  // Stub createSocket method to returns a socket created exactly like the
  // method would but with a few methods stubbed out above.
  const createSocketStub = sinon.stub(Dgram, 'createSocket');
  createSocketStub.withArgs(udpVersionExpected).returns(testSocket);

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
      test.strictEqual(sendResult, sendResultCancel);
      test.ok(false, 'Should never get here.');
    }

    test.ok(socketCloseStub.withArgs().calledOnce);
    test.done();
  });

  test.ok(createSocketStub.calledOnce);
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

// Implementation for testing all variations of sending a message to hostname.
const sendToHostAddressImpl = function(test, sinon, multiSubnetFailover, sendResult, lookupError) {
  // Set of IP addresses to be returned by stubbed out lookupAll method.
  const addresses = [
    { address: '127.0.0.2' },
    { address: '2002:20:0:0:0:0:1:3' },
    { address: '127.0.0.4' }
  ];

  // Since we're testing Sender class, we just want to verify that the 'send' method
  // on the right strategy class is being invoked. So we create the strategy class and
  // stub out the send method. In depth testing of the strategy classes will be done
  // in the unit tests for the respective classes.
  let testStrategy;
  if (multiSubnetFailover) {
    testStrategy = new ParallelSendStrategy(addresses, anyPort, anyRequest);
  } else {
    testStrategy = new SequentialSendStrategy(addresses, anyPort, anyRequest);
  }

  // Stub send method on the strategy class.
  const callback = () => { };
  const strategySendStub = sinon.stub(testStrategy, 'send');
  strategySendStub.withArgs(callback);

  const sender = new Sender(anyHost, anyPort, anyRequest, multiSubnetFailover);

  // Stub out the lookupAll method to prevent network activity from doing a DNS
  // lookup. Succeeds or fails depending on lookupError.
  const lookupAllStub = sinon.stub(sender, 'invokeLookupAll');
  lookupAllStub.callsArgWith(1, lookupError, addresses);

  // Stub the appropriate create strategy method for the test to returns a strategy
  // object created exactly like the method would but with a few methods stubbed.
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

    if (lookupError) {
      // When there is lookupError, the strategy object does not get created.
      // So there will not be a cancel call on the strategy object.
      test.strictEqual(strategyCancelStub.callCount, 0);
    } else {
      test.ok(strategyCancelStub.calledOnce);
    }
  }

  test.ok(lookupAllStub.calledOnce);

  if (lookupError) {
    // No strategy object creation and hence no send on lookupError.
    test.strictEqual(createStrategyStub.callCount, 0);
    test.strictEqual(strategySendStub.callCount, 0);
  } else {
    test.ok(createStrategyStub.calledOnce);
    test.ok(strategySendStub.calledOnce);
  }

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
    const lookupError = null;
    sendToHostAddressImpl(test, this.sinon, multiSubnetFailover, sendResultSuccess, lookupError);
  },

  'send with MultiSubnetFailover cancel': function(test) {
    const multiSubnetFailover = true;
    const lookupError = null;
    sendToHostAddressImpl(test, this.sinon, multiSubnetFailover, sendResultCancel, lookupError);
  },

  'send without MultiSubnetFailover': function(test) {
    const multiSubnetFailover = false;
    const lookupError = null;
    sendToHostAddressImpl(test, this.sinon, multiSubnetFailover, sendResultSuccess, lookupError);
  },

  'send without MultiSubnetFailover cancel': function(test) {
    const multiSubnetFailover = false;
    const lookupError = null;
    sendToHostAddressImpl(test, this.sinon, multiSubnetFailover, sendResultCancel, lookupError);
  },

  'send lookup error': function(test) {
    const multiSubnetFailover = false;
    const lookupError = new Error('some error');
    sendToHostAddressImpl(test, this.sinon, multiSubnetFailover, sendResultCancel, lookupError);
  }
};
