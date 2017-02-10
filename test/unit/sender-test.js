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

// Stub function to mimic socket emitting 'error' and 'message' events.
const emitEvent = function() {
  if (this.sendResult === sendResultError) {
    this.emit('error', this);
  } else {
    this.emit('message', this);
  }
};

// Stub function to mimic socket 'send' without causing network activity.
const sendStub = function(buffer, offset, length, port, ipAddress) {
  process.nextTick(emitEvent.bind(this));
};

// Implementation for testing all variations of sending a message to IP address.
const sendToIpAddressImpl = function(test, sinon, ipAddress, udpVersionExpected, sendResult) {
  // Create socket exactly like the Sender class would create while stubbing
  // some methods for unit testing.
  const testSocket = Dgram.createSocket(udpVersionExpected);
  const socketSendStub = sinon.stub(testSocket, 'send', sendStub);
  const socketCloseStub = sinon.stub(testSocket, 'close');

  // This allows the emitEvent method to emit the right event for the given test.
  testSocket.sendResult = sendResult;

  // Stub createSocket method to return a socket created exactly like the
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


const commonStrategyTestSetup = function() {
  // IP addresses returned by DNS reverse lookup and passed to the Strategy.
  this.testData = [
    { address: '1.2.3.4', udpVersion: udpIpv4 },
    { address: '2002:20:0:0:0:0:1:3', udpVersion: udpIpv6 },
    { address: '2002:30:0:0:0:0:2:4', udpVersion: udpIpv6 },
    { address: '5.6.7.8', udpVersion: udpIpv4 }
  ];

  // Create sockets for each of the IP addresses with send and close stubbed out to
  // prevent network activity.
  for (let j = 0; j < this.testData.length; j++) {
    this.testData[j].testSocket = Dgram.createSocket(this.testData[j].udpVersion);
    this.testData[j].socketSendStub = this.sinon.stub(this.testData[j].testSocket, 'send', sendStub);
    this.testData[j].socketCloseStub = this.sinon.stub(this.testData[j].testSocket, 'close');

    // This allows emitEvent method to fire an 'error' or 'message' event appropriately.
    // A given test may overwrite this value for specific sockets to test different
    // scenarios.
    this.testData[j].testSocket.sendResult = sendResultSuccess;
  }

  // Stub createSocket method to returns a socket created exactly like the
  // method would but with a few methods stubbed out above.
  this.createSocketStub = this.sinon.stub(Dgram, 'createSocket');
  this.createSocketStub.withArgs(udpIpv4).onFirstCall().returns(this.testData[0].testSocket);
  this.createSocketStub.withArgs(udpIpv6).onFirstCall().returns(this.testData[1].testSocket);
  this.createSocketStub.withArgs(udpIpv6).onSecondCall().returns(this.testData[2].testSocket);
  this.createSocketStub.withArgs(udpIpv4).onSecondCall().returns(this.testData[3].testSocket);
};

exports['ParallelSendStrategy'] = {
  setUp: function(done) {
    this.sinon = Sinon.sandbox.create();
    commonStrategyTestSetup.call(this);
    done();
  },

  tearDown: function(done) {
    this.sinon.restore();
    done();
  },

  'send all IPs success.': function(test) {
    const parallelSendStrategy = new ParallelSendStrategy(this.testData, anyPort, anyRequest);
    parallelSendStrategy.send((error, message) => {
      test.strictEqual(error, null);

      // We should get the message only on the first socket.
      test.strictEqual(message, this.testData[0].testSocket);

      for (let j = 0; j < this.testData.length; j++) {
        test.ok(this.testData[j].socketSendStub.calledOnce);
        test.ok(this.testData[j].socketCloseStub.calledOnce);
      }

      test.strictEqual(this.createSocketStub.callCount, this.testData.length);

      test.done();
    });
  },

  'send one IP fail.': function(test) {
    // Setup first socket to fail on socket send.
    this.testData[0].testSocket.sendResult = sendResultError;

    const parallelSendStrategy = new ParallelSendStrategy(this.testData, anyPort, anyRequest);
    parallelSendStrategy.send((error, message) => {
      // Even though the first socket fails on send, we should not get an error
      // as the other sockets succeed.
      test.strictEqual(error, null);

      // We setup the first send to fail. So we should get the message on the
      // second socket.
      test.strictEqual(message, this.testData[1].testSocket);

      for (let j = 0; j < this.testData.length; j++) {
        test.ok(this.testData[j].socketSendStub.calledOnce);
        test.ok(this.testData[j].socketCloseStub.calledOnce);
      }

      test.strictEqual(this.createSocketStub.callCount, this.testData.length);

      test.done();
    });
  },

  'send two IPs fail.': function(test) {
    // Setup first two sockets to fail on socket send.
    this.testData[0].testSocket.sendResult = sendResultError;
    this.testData[1].testSocket.sendResult = sendResultError;

    const parallelSendStrategy = new ParallelSendStrategy(this.testData, anyPort, anyRequest);
    parallelSendStrategy.send((error, message) => {
      // Even though the first two sockets fails on send, we should not get an error
      // as the other sockets succeed.
      test.strictEqual(error, null);

      // We setup the first two sends to fail. So we should get the message on the
      // third socket.
      test.strictEqual(message, this.testData[2].testSocket);

      for (let j = 0; j < this.testData.length; j++) {
        test.ok(this.testData[j].socketSendStub.calledOnce);
        test.ok(this.testData[j].socketCloseStub.calledOnce);
      }

      test.strictEqual(this.createSocketStub.callCount, this.testData.length);

      test.done();
    });
  },

  'send all IPs fail.': function(test) {
    // Setup all sockets to fail on socket send.
    for (let j = 0; j < this.testData.length; j++) {
      this.testData[j].testSocket.sendResult = sendResultError;
    }

    const parallelSendStrategy = new ParallelSendStrategy(this.testData, anyPort, anyRequest);
    parallelSendStrategy.send((error, message) => {
      // All socket sends fail. We should get an error on the last socket fail.
      test.strictEqual(error, this.testData[this.testData.length - 1].testSocket);

      test.strictEqual(message, undefined);

      for (let j = 0; j < this.testData.length; j++) {
        test.ok(this.testData[j].socketSendStub.calledOnce);
        test.ok(this.testData[j].socketCloseStub.calledOnce);
      }

      test.strictEqual(this.createSocketStub.callCount, this.testData.length);

      test.done();
    });
  },

  'send cancel.': function(test) {
    const parallelSendStrategy = new ParallelSendStrategy(this.testData, anyPort, anyRequest);
    parallelSendStrategy.send((error, message) => {
      // We should not get a callback as the send got cancelled.
      test.ok(false, 'Should never get here.');
    });

    parallelSendStrategy.cancel();

    for (let j = 0; j < this.testData.length; j++) {
      test.ok(this.testData[j].socketSendStub.calledOnce);
      test.ok(this.testData[j].socketCloseStub.calledOnce);
    }

    test.strictEqual(this.createSocketStub.callCount, this.testData.length);

    test.done();
  }
};

exports['SequentialSendStrategy'] = {
  setUp: function(done) {
    this.sinon = Sinon.sandbox.create();
    commonStrategyTestSetup.call(this);
    done();
  },

  tearDown: function(done) {
    this.sinon.restore();
    done();
  },

  'send all IPs success.': function(test) {
    const sequentialSendStrategy = new SequentialSendStrategy(this.testData, anyPort, anyRequest);
    sequentialSendStrategy.send((error, message) => {
      test.strictEqual(error, null);

      // We should get the message only on the first socket.
      test.strictEqual(message, this.testData[0].testSocket);

      test.ok(this.testData[0].socketSendStub.calledOnce);
      test.ok(this.testData[0].socketCloseStub.calledOnce);

      // Send should be invoked only on the first socket.
      for (let j = 1; j < this.testData.length; j++) {
        test.strictEqual(this.testData[j].socketSendStub.callCount, 0);
        test.strictEqual(this.testData[j].socketCloseStub.callCount, 0);
      }

      test.strictEqual(this.createSocketStub.callCount, 1);

      test.done();
    });
  },

  'send one IP fail.': function(test) {
    // Setup first socket to fail on socket send.
    this.testData[0].testSocket.sendResult = sendResultError;

    const sequentialSendStrategy = new SequentialSendStrategy(this.testData, anyPort, anyRequest);
    sequentialSendStrategy.send((error, message) => {
      test.strictEqual(error, null);

      // We should get the message on the second socket as the first one fails.
      test.strictEqual(message, this.testData[1].testSocket);

      // Send should be invoked only on the first two sockets.
      for (let j = 0; j < this.testData.length; j++) {
        if (j < 2) {
          test.ok(this.testData[j].socketSendStub.calledOnce);
          test.ok(this.testData[j].socketCloseStub.calledOnce);
        } else {
          test.strictEqual(this.testData[j].socketSendStub.callCount, 0);
          test.strictEqual(this.testData[j].socketCloseStub.callCount, 0);
        }
      }

      // Since the first socket send fails, we should have two invocations of createSocket.
      test.strictEqual(this.createSocketStub.callCount, 2);

      test.done();
    });
  },

  'send two IPs fail.': function(test) {
    // Setup first two socket to fail on socket send.
    this.testData[0].testSocket.sendResult = sendResultError;
    this.testData[1].testSocket.sendResult = sendResultError;

    const sequentialSendStrategy = new SequentialSendStrategy(this.testData, anyPort, anyRequest);
    sequentialSendStrategy.send((error, message) => {
      test.strictEqual(error, null);

      // We should get the message on the third socket as the first two fails.
      test.strictEqual(message, this.testData[2].testSocket);

      // Send should be invoked only on the first three sockets.
      for (let j = 0; j < this.testData.length; j++) {
        if (j < 3) {
          test.ok(this.testData[j].socketSendStub.calledOnce);
          test.ok(this.testData[j].socketCloseStub.calledOnce);
        } else {
          test.strictEqual(this.testData[j].socketSendStub.callCount, 0);
          test.strictEqual(this.testData[j].socketCloseStub.callCount, 0);
        }
      }

      // Since the first two socket sends fail, we should have three invocations of createSocket.
      test.strictEqual(this.createSocketStub.callCount, 3);

      test.done();
    });
  },

  'send all IPs fail.': function(test) {
    // Setup all sockets to fail on socket send.
    for (let j = 0; j < this.testData.length; j++) {
      this.testData[j].testSocket.sendResult = sendResultError;
    }

    const sequentialSendStrategy = new SequentialSendStrategy(this.testData, anyPort, anyRequest);
    sequentialSendStrategy.send((error, message) => {
      // All socket sends fail. We should get an error on the last socket fail.
      test.strictEqual(error, this.testData[this.testData.length - 1].testSocket);

      test.strictEqual(message, undefined);

      // Send should be invoked on all sockets.
      for (let j = 0; j < this.testData.length; j++) {
        test.ok(this.testData[j].socketSendStub.calledOnce);
        test.ok(this.testData[j].socketCloseStub.calledOnce);
      }

      test.strictEqual(this.createSocketStub.callCount, this.testData.length);

      test.done();
    });
  },

  'send cancel.': function(test) {
    const sequentialSendStrategy = new SequentialSendStrategy(this.testData, anyPort, anyRequest);
    sequentialSendStrategy.send((error, message) => {
      // We should not get a callback as the send got cancelled.
      test.ok(false, 'Should never get here.');
    });

    sequentialSendStrategy.cancel();

    // Send should be invoked only on the first socket.
    for (let j = 0; j < this.testData.length; j++) {
      if (j === 0) {
        test.ok(this.testData[j].socketSendStub.calledOnce);
        test.ok(this.testData[j].socketCloseStub.calledOnce);
      } else {
        test.strictEqual(this.testData[j].socketSendStub.callCount, 0);
        test.strictEqual(this.testData[j].socketCloseStub.callCount, 0);
      }
    }

    test.strictEqual(this.createSocketStub.callCount, 1);

    test.done();
  }
};
