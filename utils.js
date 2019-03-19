const { tmpdir } = require('os')
const path = require('path')
const { readFile } = require('fs-extra')
const { equals, not, packDir, isArchivePath, pick } = require('ramda')
const { packDir, isArchivePath } = require('@serverless/components')

const getAccountId = async (aws) => {
  const STS = new aws.STS()
  const res = await STS.getCallerIdentity({}).promise()
  return res.Account
}

const createLambda = async ({
  lambda,
  name,
  handler,
  memory,
  timeout,
  runtime,
  env,
  description,
  zipPath,
  bucket,
  role
}) => {
  const params = {
    FunctionName: name,
    Code: {},
    Description: description,
    Handler: handler,
    MemorySize: memory,
    Publish: true,
    Role: role.arn,
    Runtime: runtime,
    Timeout: timeout,
    Environment: {
      Variables: env
    }
  }

  if (bucket) {
    params.Code.S3Bucket = bucket
    params.Code.S3Key = path.basename(zipPath)
  } else {
    params.Code.ZipFile = await readFile(zipPath)
  }

  const res = await lambda.createFunction(params).promise()

  return res.FunctionArn
}

const updateLambda = async ({
  lambda,
  name,
  handler,
  memory,
  timeout,
  runtime,
  env,
  description,
  zipPath,
  bucket,
  role
}) => {
  const functionCodeParams = {
    FunctionName: name,
    Publish: true
  }

  if (bucket) {
    functionCodeParams.S3Bucket = bucket
    functionCodeParams.S3Key = path.basename(zipPath)
  } else {
    functionCodeParams.ZipFile = await readFile(zipPath)
  }

  const functionConfigParams = {
    FunctionName: name,
    Description: description,
    Handler: handler,
    MemorySize: memory,
    Role: role.arn,
    Runtime: runtime,
    Timeout: timeout,
    Environment: {
      Variables: env
    }
  }

  await lambda.updateFunctionCode(functionCodeParams).promise()
  const res = await lambda.updateFunctionConfiguration(functionConfigParams).promise()

  return res.FunctionArn
}

const getLambda = async ({ lambda, name }) => {
  try {
    const res = await lambda
      .getFunctionConfiguration({
        FunctionName: name
      })
      .promise()

    return {
      name: res.FunctionName,
      description: res.Description,
      timeout: res.Timeout,
      runtime: res.Runtime,
      role: {
        arn: res.Role
      },
      handler: res.Handler,
      memory: res.MemorySize,
      hash: res.CodeSha256,
      env: res.Environment ? res.Environment.Variables : {},
      arn: res.FunctionArn
    }
  } catch (e) {
    if (e.code === 'ResourceNotFoundException') {
      return null
    }
    throw e
  }
}

const deleteLambda = async ({ lambda, name }) => {
  try {
    const params = { FunctionName: name }
    await lambda.deleteFunction(params).promise()
  } catch (error) {
    if (error.code !== 'ResourceNotFoundException') {
      throw error
    }
  }
}

const getPolicy = async ({ name, region, accountId }) => {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Action: ['logs:CreateLogStream'],
        Resource: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/${name}:*`],
        Effect: 'Allow'
      },
      {
        Action: ['logs:PutLogEvents'],
        Resource: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/${name}:*:*`],
        Effect: 'Allow'
      }
    ]
  }
}

const configChanged = (pervLambda, lambda) => {
  const keys = ['description', 'runtime', 'role', 'handler', 'memory', 'timeout', 'env', 'hash']
  const inputs = pick(keys, lambda)
  inputs.role = { arn: inputs.role.arn } // remove other inputs.role component outputs
  const prevInputs = pick(keys, pervLambda)
  return not(equals(inputs, prevInputs))
}

const pack = async (code, shims = []) => {
  if (isArchivePath(code)) {
    return path.resolve(code)
  }
  const outputFilePath = path.join(
    tmpdir(),
    `${Math.random()
      .toString(36)
      .substring(6)}.zip`
  )

  return packDir(code, outputFilePath, shims)
}

module.exports = {
  createLambda,
  updateLambda,
  getLambda,
  deleteLambda,
  getPolicy,
  getAccountId,
  configChanged,
  pack
}
