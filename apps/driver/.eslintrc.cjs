// require.resolve, not the bare specifier: ESLint 8's own `extends` resolver does not honour
// a package's `exports` map, while Node's require does. The bare form fails with
// "couldn't find the config to extend from" even though the file is plainly there.
//
// `eslint.react.cjs`, not `eslint.base.cjs`. This app is entirely React Native screens, and the
// base config carries no React plugin — so `react-hooks/rules-of-hooks` was not running here at
// all, while the customer app has had it all along. That gap let a conditional `useOfferRing()`
// call sit below an early return in `app/offer/[offerId].tsx` and lint clean: accepting a trip
// then rendered fewer hooks than the render before, which crashed the offer screen and left the
// ring playing over the crash.
module.exports = {
  root: true,
  extends: [require.resolve('@driverzone/config/eslint.react.cjs')],
  ignorePatterns: ['android/', 'ios/', '.expo/'],
};
