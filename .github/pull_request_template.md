## 这个改动做了什么

<!-- 一句话。如果是修 bug，写明"什么情况下会出错" -->

## 为什么这么做

<!-- 贴规格编号（ILB-x.y.z）或决策记录（D-xxxx）。没有编号的改动，先讨论再开 PR -->

## 我验证了什么

- [ ] `node --test tests/core.test.mjs tests/flow.test.mjs tests/search.test.mjs tests/snapshot.test.mjs tests/import-plan.test.mjs tests/ui-layout.test.mjs`
- [ ] `node tests/linkcheck.mjs`
- [ ] `node tests/smoke-dom.mjs`
- [ ] 我在真实 SillyTavern 里点过（如果是界面相关，请写清桌面 / 手机）

## 需要同步的文档

- [ ] `docs/CHANGELOG.md` 加了条目（写清"待验证"的部分）
- [ ] 如果换了做法，`docs/决策记录.md` 加了 D-xxxx
- [ ] 如果改了规则，`docs/参考文档.md` 里对应编号已更新
