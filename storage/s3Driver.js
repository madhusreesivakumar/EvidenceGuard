'use strict';

/**
 * storage/s3Driver.js
 * Sprint 11A – S3 & MinIO Compatible Storage Driver (AWS SDK v3)
 *
 * Implements standard storage interface:
 * - save(source, storageKey, options)
 * - getStream(storageKey)
 * - remove(storageKey)
 * - exists(storageKey)
 * - stat(storageKey)
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');
const fs = require('fs');

let s3ClientInstance = null;

function getClient() {
  if (!s3ClientInstance) {
    const config = {
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'false' ? false : true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin'
      }
    };

    if (process.env.S3_ENDPOINT) {
      config.endpoint = process.env.S3_ENDPOINT;
    }

    s3ClientInstance = new S3Client(config);
  }
  return s3ClientInstance;
}

function getBucket() {
  return process.env.S3_BUCKET || 'evidenceguard-evidence';
}

function setClient(client) {
  s3ClientInstance = client;
}

const save = async (source, storageKey, options = {}) => {
  const client = getClient();
  const bucket = getBucket();

  let body = source;
  let contentLength = options.size;

  if (typeof source === 'string') {
    const s = await fs.promises.stat(source);
    contentLength = s.size;
    body = fs.createReadStream(source);
  } else if (Buffer.isBuffer(source)) {
    contentLength = source.length;
  }

  const putParams = {
    Bucket: bucket,
    Key: storageKey,
    Body: body,
    ContentType: options.contentType || 'application/octet-stream'
  };

  if (typeof contentLength === 'number') {
    putParams.ContentLength = contentLength;
  }

  await client.send(new PutObjectCommand(putParams));
  return { storageKey, bucket };
};

const getStream = async (storageKey) => {
  const client = getClient();
  const bucket = getBucket();

  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey
    }));
    return response.Body;
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      const notFoundErr = new Error(`Object not found in S3 bucket '${bucket}': ${storageKey}`);
      notFoundErr.code = 'ENOENT';
      throw notFoundErr;
    }
    throw err;
  }
};

const remove = async (storageKey) => {
  const client = getClient();
  const bucket = getBucket();

  try {
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: storageKey
    }));
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return; // Idempotent remove
    }
    throw err;
  }
};

const exists = async (storageKey) => {
  const client = getClient();
  const bucket = getBucket();

  try {
    await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: storageKey
    }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
};

const stat = async (storageKey) => {
  const client = getClient();
  const bucket = getBucket();

  try {
    const response = await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: storageKey
    }));
    return {
      size: response.ContentLength,
      lastModified: response.LastModified
    };
  } catch (err) {
    if (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      const notFoundErr = new Error(`Object not found in S3 bucket '${bucket}': ${storageKey}`);
      notFoundErr.code = 'ENOENT';
      throw notFoundErr;
    }
    throw err;
  }
};

module.exports = {
  save,
  getStream,
  remove,
  exists,
  stat,
  getClient,
  setClient,
  getBucket
};
