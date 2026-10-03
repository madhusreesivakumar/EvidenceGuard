'use strict';

/**
 * services/tenantScope.js
 * Tenant Isolation Layer
 *
 * Automatically injects orgId into every find, update, delete, count,
 * and aggregate ($match first), and throws if orgId is missing.
 *
 * orgId comes only from the authenticated user loaded from the database,
 * never from the body, query, header or JWT claim.
 *
 * Provides an explicit, greppable unscoped() escape hatch for platform tasks only.
 */

const TENANT_MODELS = [
  'Evidence',
  'Block',
  'AuditLog',
  'Verification',
  'CustodyEvent',
  'Notification',
  'ForensicReport',
  'Anchor',
  'UserKey',
  'Counter',
  'User'
];

/**
 * Extracts and strictly validates orgId from an authenticated user doc or direct orgId.
 * Throws if orgId is missing or invalid.
 *
 * @param {string|object} userOrOrgId - Authenticated User document or orgId string
 * @returns {string} - Validated orgId
 */
function extractOrgId(userOrOrgId) {
  let orgId = null;

  if (typeof userOrOrgId === 'string') {
    orgId = userOrOrgId.trim();
  } else if (userOrOrgId && typeof userOrOrgId === 'object') {
    if (typeof userOrOrgId.orgId === 'string') {
      orgId = userOrOrgId.orgId.trim();
    }
  }

  if (!orgId) {
    throw new Error('Tenant isolation violation: orgId is missing or invalid');
  }

  return orgId;
}

/**
 * Creates a scoped wrapper around a Mongoose Model.
 *
 * @param {import('mongoose').Model} Model - Mongoose model to wrap
 * @param {string|object} userOrOrgId - Authenticated user doc or validated orgId
 * @returns {Function} Scoped Model wrapper
 */
function createScopedModel(Model, userOrOrgId) {
  if (!Model) {
    throw new Error('scoped() requires a valid Mongoose Model');
  }

  const orgId = extractOrgId(userOrOrgId);

  // Scoped constructor for new Model(data)
  function ScopedModel(data = {}) {
    if (data && typeof data === 'object') {
      if (data.orgId && data.orgId !== orgId) {
        throw new Error(`Tenant isolation violation: record orgId "${data.orgId}" does not match scoped orgId "${orgId}"`);
      }
      data.orgId = orgId;
    }
    return new Model(data);
  }

  // Filter injector
  function injectFilter(filter = {}) {
    if (filter && typeof filter === 'object') {
      if (filter.orgId && filter.orgId !== orgId) {
        throw new Error(`Tenant isolation violation: filter orgId "${filter.orgId}" does not match scoped orgId "${orgId}"`);
      }
      return { ...filter, orgId };
    }
    return { orgId };
  }

  // Aggregate pipeline injector ($match first)
  function injectPipeline(pipeline = []) {
    const list = Array.isArray(pipeline) ? [...pipeline] : [pipeline];
    if (list.length > 0 && list[0] && list[0].$match) {
      list[0] = { $match: { ...list[0].$match, orgId } };
    } else {
      list.unshift({ $match: { orgId } });
    }
    return list;
  }

  // Query and read methods
  ScopedModel.find = function (filter, ...args) {
    return Model.find(injectFilter(filter), ...args);
  };

  ScopedModel.findOne = function (filter, ...args) {
    return Model.findOne(injectFilter(filter), ...args);
  };

  ScopedModel.findById = function (id, ...args) {
    return Model.findOne({ _id: id, orgId }, ...args);
  };

  ScopedModel.countDocuments = function (filter, ...args) {
    return Model.countDocuments(injectFilter(filter), ...args);
  };

  ScopedModel.estimatedDocumentCount = function () {
    return Model.countDocuments({ orgId });
  };

  ScopedModel.distinct = function (field, filter, ...args) {
    return Model.distinct(field, injectFilter(filter), ...args);
  };

  // Mutation and write methods
  ScopedModel.updateOne = function (filter, update, ...args) {
    return Model.updateOne(injectFilter(filter), update, ...args);
  };

  ScopedModel.updateMany = function (filter, update, ...args) {
    return Model.updateMany(injectFilter(filter), update, ...args);
  };

  ScopedModel.findOneAndUpdate = function (filter, update, ...args) {
    return Model.findOneAndUpdate(injectFilter(filter), update, ...args);
  };

  ScopedModel.findByIdAndUpdate = function (id, update, ...args) {
    return Model.findOneAndUpdate({ _id: id, orgId }, update, ...args);
  };

  ScopedModel.deleteOne = function (filter, ...args) {
    return Model.deleteOne(injectFilter(filter), ...args);
  };

  ScopedModel.deleteMany = function (filter, ...args) {
    return Model.deleteMany(injectFilter(filter), ...args);
  };

  ScopedModel.findOneAndDelete = function (filter, ...args) {
    return Model.findOneAndDelete(injectFilter(filter), ...args);
  };

  ScopedModel.findByIdAndDelete = function (id, ...args) {
    return Model.findOneAndDelete({ _id: id, orgId }, ...args);
  };

  ScopedModel.aggregate = function (pipeline, ...args) {
    return Model.aggregate(injectPipeline(pipeline), ...args);
  };

  ScopedModel.create = function (docs, ...args) {
    if (Array.isArray(docs)) {
      docs.forEach(d => {
        if (d && typeof d === 'object') {
          if (d.orgId && d.orgId !== orgId) {
            throw new Error(`Tenant isolation violation: cannot create record with orgId "${d.orgId}"`);
          }
          d.orgId = orgId;
        }
      });
    } else if (docs && typeof docs === 'object') {
      if (docs.orgId && docs.orgId !== orgId) {
        throw new Error(`Tenant isolation violation: cannot create record with orgId "${docs.orgId}"`);
      }
      docs.orgId = orgId;
    }
    return Model.create(docs, ...args);
  };

  ScopedModel.insertMany = function (docs, ...args) {
    if (Array.isArray(docs)) {
      docs.forEach(d => {
        if (d && typeof d === 'object') {
          if (d.orgId && d.orgId !== orgId) {
            throw new Error(`Tenant isolation violation: cannot insert record with orgId "${d.orgId}"`);
          }
          d.orgId = orgId;
        }
      });
    }
    return Model.insertMany(docs, ...args);
  };

  // Static properties and metadata pass-through
  ScopedModel.schema = Model.schema;
  ScopedModel.modelName = Model.modelName;
  ScopedModel.collection = Model.collection;
  ScopedModel.orgId = orgId;
  ScopedModel.unscoped = () => Model;

  // Proxy remaining methods (like syncIndexes, startSession, populate, etc.)
  return new Proxy(ScopedModel, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      return Model[prop];
    }
  });
}

/**
 * Universal Scoped Accessor:
 * - scoped(Model, userOrOrgId) -> Scoped model wrapper
 * - scoped(userOrOrgId) -> Scoped tenant context object
 */
function scoped(firstArg, secondArg) {
  if (secondArg !== undefined) {
    return createScopedModel(firstArg, secondArg);
  }

  const orgId = extractOrgId(firstArg);
  return new Proxy({}, {
    get(target, prop) {
      if (typeof prop === 'string') {
        try {
          const Model = require(`../models/${prop}`);
          return createScopedModel(Model, orgId);
        } catch (e) {
          // not a valid model file
        }
      }
      return target[prop];
    }
  });
}

/**
 * Explicit, greppable escape hatch for platform-wide / administrative tasks only.
 *
 * @param {import('mongoose').Model} Model
 * @returns {import('mongoose').Model} Raw Mongoose Model
 */
function unscoped(Model) {
  if (!Model) {
    throw new Error('unscoped() requires a Mongoose Model');
  }
  return Model;
}

module.exports = {
  scoped,
  unscoped,
  extractOrgId,
  TENANT_MODELS
};
