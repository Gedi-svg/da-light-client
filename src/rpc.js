const { JSONRPCServer } = require('json-rpc-2.0')
const express = require('express')
const cors = require('cors')
const { serialiseConfidence } = require('./utils')

const port = process.env.PORT || 7000

let state, lc
const server = new JSONRPCServer()

// Supported JSON-RPC method, where given decimal block number ( as utf-8 string )
// returns confidence associated with it
server.addMethod('get_blockConfidence', async ({ number }) => {

    // This is a closure hook, which will be invoked before
    // responding to obtained confidence RPC query
    //
    // If we've already seen request for this block before
    // ( or processed it, because we caught this block
    // while listening to it ), it'll be responded back immediately
    // with stored confidence. But for this time seen blocks, it'll
    // attempt to gain confidence & then respond back to client
    //
    // @note It can be time consuming for second case
    async function wrapperOnConfidenceFetcher(number) {
        if (number < 1n) {
            return 0
        }

        if (state.alreadyVerified(number.toString(10))) {
            return state.getConfidence(number.toString(10))
        }

        if (state.latestBlock < number) {
            return 0
        }

        const resp = await lc.processBlockByNumber(number)
        if (resp.status != 1) {
            return 0
        }

        return state.getConfidence(number.toString(10))
    }

    async function getConfidence(number) {
        const confidence = await wrapperOnConfidenceFetcher(BigInt(number))
        return {
            number: parseInt(number),
            confidence,
            serialisedConfidence: serialiseConfidence(number, Math.round(confidence * 10 ** 7))
        }
    }

    return typeof number === 'string' && /^((0[xX][0-9a-fA-F]+)|(\d+))$/.test(number)
        ? getConfidence(number)
        : typeof number === 'number'
            ? getConfidence(number.toString())
            :
            {
                number,
                confidence: 0,
                error: 'Block number must be number/ string'
            }
})

server.addMethod('get_progress', _ => {

    return {
        verified: state.done().toString(),
        startedBlock: state.startedBlock.toString(),
        latestBlock: state.latestBlock.toString(),
        uptime: state.uptime()
    }

})

const app = express()
app.use(express.json())
app.use(cors())

app.post('/v1/json-rpc', (req, res) => {

    console.log(`⚡️ Received JSON-RPC request from ${req.ip} at ${new Date().toISOString()}`)

    server.receive(req.body).then((jsonRPCResp) => {
        if (jsonRPCResp) {
            res.json(jsonRPCResp)
        } else {
            res.sendStatus(204)
        }
    })

})

app.get('/v1/confidence/:block', (req, res) => {

    console.log(`⚡️ Block Confidence ${req.params.block} | ${req.ip} | ${new Date().toISOString()}`)

    let body = {
        jsonrpc: "2.0",
        method: "get_blockConfidence",
        params: { number: req.params.block },
        id: 1
    }
    server.receive(body).then((jsonRPCResp) => {
        if (jsonRPCResp) {
            res.json(jsonRPCResp)
        } else {
            res.sendStatus(204)
        }
    })

})

const startServer = (_state, _lc) => {

    // Initialising state holder, so that JSON-RPC queries can be
    // answered
    state = _state
    lc = _lc
    // Starting JSON-RPC server
    app.listen(port, _ => {
        console.log(`✅ Running JSON-RPC server @ http://localhost:${port}`)
    })


}

module.exports = { startServer }
