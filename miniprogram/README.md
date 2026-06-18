# A股联网估值微信小程序

这个目录是微信小程序版本，和根目录公网网站并存。当前小程序不会影响 GitHub Pages 网站。

## 打开方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择本目录：`miniprogram/`。
4. AppID 先可使用测试号或你自己的正式 AppID。
5. 本地调试时，如果还没有配置合法域名，可在开发者工具里临时勾选“不校验合法域名、web-view 域名、TLS 版本以及 HTTPS 证书”。

## 主要能力

- 输入公司名称或股票代码后联网取数。
- 支持沪市、深市、创业板、科创板、常见北交所代码。
- 自动获取实时股价、总股本、市值、股息率、毛利率、负债率。
- 自动获取财务报表、现金流 D&A、Capex、盈利预测和中长期走势。
- 使用与网页版本一致的市场行业环境因子、综合卖点、投行估值和行业适配估值方法。
- 支持好友分享和朋友圈分享，分享路径会带上当前股票代码。

## 正式发布前需要配置的请求域名

微信小程序正式体验版、发布版需要在微信公众平台配置 `request合法域名`。当前代码使用这些 HTTPS 域名：

- `https://searchapi.eastmoney.com`
- `https://push2delay.eastmoney.com`
- `https://datacenter-web.eastmoney.com`
- `https://emweb.eastmoney.com`
- `https://push2his.eastmoney.com`
- `https://basic.10jqka.com.cn`
- `https://proxy.finance.qq.com`

如果微信平台不允许直接配置第三方金融数据域名，建议后续加一层你自己的云函数或服务器代理，再把小程序请求域名收敛到自己的域名。当前版本先按直接联网版本实现。

## 分享说明

首页已实现：

- `onShareAppMessage`
- `onShareTimeline`
- 页面内“分享给朋友”按钮

正式对外分享给所有微信用户使用，仍需要小程序完成真实 AppID 配置、合法域名配置、上传代码并发布版本。现在按你的要求，暂不上传和提交审核。

## 与公网网站的关系

- 公网网站入口仍然是根目录 `index.html`。
- 小程序入口在 `miniprogram/pages/index/index`。
- 两者代码相互独立，后续可以分别维护。
