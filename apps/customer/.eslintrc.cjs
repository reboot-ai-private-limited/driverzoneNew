// require.resolve, not the bare specifier: ESLint 8's own `extends` resolver does not honour
// a package's `exports` map, while Node's require does. The bare form fails with
// "couldn't find the config to extend from" even though the file is plainly there.
module.exports = {
  root: true,
  extends: [require.resolve('@driverzone/config/eslint.react.cjs')],
  ignorePatterns: ['android/', 'ios/', '.expo/'],
};
