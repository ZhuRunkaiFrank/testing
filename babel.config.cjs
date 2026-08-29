module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    // 'automatic' matches what react-scripts (CRA) does at build time, so files
    // that use JSX without importing React (e.g. context/cart.js) also compile
    // under Jest.
    ['@babel/preset-react', { runtime: 'automatic' }]
  ]
};
