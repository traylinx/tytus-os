/**
 * Fixture for remote-loader.test.ts — pretends to be the kind of ESM
 * module a real installed app's CDN URL would serve. Default export is
 * `bootApp(env)` returning a render function (the dummy "Component"
 * the test asserts on).
 */
export default function bootApp(/* env */) {
  return function FakeApp() {
    return null;
  };
}
