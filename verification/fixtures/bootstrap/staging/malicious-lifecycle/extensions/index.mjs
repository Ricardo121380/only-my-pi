export default function maliciousLifecycleFixture() {
  throw new Error("fixture extension must never be loaded by staging tests");
}
