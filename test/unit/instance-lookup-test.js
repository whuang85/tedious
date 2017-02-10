'use strict';

const parse = require('../../src/instance-lookup').parseBrowserResponse;
const instanceLookup = require('../../src/instance-lookup').instanceLookup;

exports['instanceLookup invalid args'] = {
  'invalid server': function(test) {
    const expectedErrorMessage = 'Invalid arguments: "server" must be a string';
    try {
      const notString = 4;
      instanceLookup({ server: notString });
    } catch (err) {
      test.strictEqual(err.message, expectedErrorMessage);
      test.done();
    }
  },

  'invalid instanceName': function(test) {
    const expectedErrorMessage = 'Invalid arguments: "instanceName" must be a string';
    try {
      const notString = 4;
      instanceLookup({ server: 'serverName', instanceName: notString });
    } catch (err) {
      test.strictEqual(err.message, expectedErrorMessage);
      test.done();
    }
  },

  'invalid timeout': function(test) {
    const expectedErrorMessage = 'Invalid arguments: "timeout" must be a number';
    try {
      const notNumber = 'some string';
      instanceLookup({ server: 'server', instanceName: 'instance', timeout: notNumber });
    } catch (err) {
      test.strictEqual(err.message, expectedErrorMessage);
      test.done();
    }
  },

  'invalid retries': function(test) {
    const expectedErrorMessage = 'Invalid arguments: "retries" must be a number';
    try {
      const notNumber = 'some string';
      instanceLookup({ server: 'server', instanceName: 'instance', timeout: 1000, retries: notNumber });
    } catch (err) {
      test.strictEqual(err.message, expectedErrorMessage);
      test.done();
    }
  },

  'invalid callback': function(test) {
    const expectedErrorMessage = 'Invalid arguments: "callback" must be a function';
    try {
      const notFunction = 4;
      instanceLookup({ server: 'server', instanceName: 'instance', timeout: 1000, retries: 3 }, notFunction);
    } catch (err) {
      test.strictEqual(err.message, expectedErrorMessage);
      test.done();
    }
  }
};

exports.oneInstanceFound = function(test) {
  const response = 'ServerName;WINDOWS2;InstanceName;SQLEXPRESS;IsClustered;No;Version;10.50.2500.0;tcp;1433;;';

  test.strictEqual(parse(response, 'sqlexpress'), 1433);
  test.done();
};

exports.twoInstancesFoundInFirst = function(test) {
  const response =
    'ServerName;WINDOWS2;InstanceName;SQLEXPRESS;IsClustered;No;Version;10.50.2500.0;tcp;1433;;' +
    'ServerName;WINDOWS2;InstanceName;XXXXXXXXXX;IsClustered;No;Version;10.50.2500.0;tcp;0;;';

  test.strictEqual(parse(response, 'sqlexpress'), 1433);
  test.done();
};

exports.twoInstancesFoundInSecond = function(test) {
  const response =
    'ServerName;WINDOWS2;InstanceName;XXXXXXXXXX;IsClustered;No;Version;10.50.2500.0;tcp;0;;' +
    'ServerName;WINDOWS2;InstanceName;SQLEXPRESS;IsClustered;No;Version;10.50.2500.0;tcp;1433;;';

  test.strictEqual(parse(response, 'sqlexpress'), 1433);
  test.done();
};

exports.twoInstancesNotFound = function(test) {
  const response =
    'ServerName;WINDOWS2;InstanceName;XXXXXXXXXX;IsClustered;No;Version;10.50.2500.0;tcp;0;;' +
    'ServerName;WINDOWS2;InstanceName;YYYYYYYYYY;IsClustered;No;Version;10.50.2500.0;tcp;0;;';

  test.strictEqual(parse(response, 'sqlexpress'), undefined);
  test.done();
};
