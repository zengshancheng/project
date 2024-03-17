import { HttpProxy, IHttpProxyReq, IHttpProxyRes, recvAll, DnsServer } from "../../tools/release/node/HttpProxy";
// import { SaveLog } from "../../tools/release/node/SaveLog";
import * as crypto from "crypto";
import * as https from "https";
import * as dns from "dns";
import { sm2 } from "sm-crypto";

// adb shell settings put global http_proxy 192.168.1.104:8080
// adb install -r -d 1.apk
/**
 * cd /data/misc/user/0/cacerts-added #移动至于用户证书目录
 * mount -o remount,rw /system #将系统证书目录权限改成可读可写就可以移动文件不然不行
 * cp * /etc/security/cacerts/ #这里可以使用cp也可以使用mv
 */
// const saveLog = new SaveLog();
let timeXC: number | null = null;
const getDate = () => new Date(new Date().getTime() + (timeXC ?? 0) * 1000);
const MD5 = (str: string, encoding: crypto.BinaryToTextEncoding = "hex") =>
  crypto.createHash("md5").update(str).digest(encoding);
const publicKey =
  "049d578dfe80bce0af275effbb7036ac0b61af26727585621c9ae7f4019a0b3dd3fb9bf97146438a1336d7a9b3edc03893a6b70505ea4ebd350e3eae2aadf21253";

const getCiphertext = (phone: string, timestamp = Math.floor(Date.now() / 1000)) => {
  const buf = Buffer.from(
    "\0\0" +
      String(timestamp) +
      "\0" +
      MD5(phone.substr(-4) + "wtt") +
      "\0".repeat(32) +
      "\0" +
      String(timestamp) +
      "\0" +
      MD5(Math.random() + "1").substring(0, 17)
  );
  return "V02_" + sm2.encrypt([...buf], publicKey, 1);
};

const getRequestid = () => {
  let o = "";
  do {
    o += crypto
      .createHash("md5")
      .update(Math.random() + "1")
      .digest("base64")
      .replace(/[^a-z]/gi, "");
  } while (o.length < 32);
  return o.substring(0, 32);
};
const position = {
  lat: 22.520747884114583 + Math.random() - 0.5,
  lng: 113.94159857855903 + Math.random() - 0.5,
};
const cookieObj: { [x: string]: string } = {};
const setCookie = (cookie: string) => {
  cookie = cookie.trim();
  const index = cookie.indexOf("=");
  if (!cookie || index < 0) return;
  cookieObj[cookie.substring(0, index).trim()] = cookie.substring(index + 1).trim();
};

const taskSet: Set<string> = new Set();

dns.resolve4("nswtt.rim20.com", (err, [addresses]) => {
  console.log("nswtt.rim20.com的ip为", addresses);
  console.log("请现在打开电脑微信小程序，进入【抢券界面】");
  console.log(
    "脚本运行途中，若要关闭请按多几次Ctrl+C，脚本会执行退出流程。请勿直接关掉脚本，否则电脑可能无法上网！！！"
  );
  console.log("-----------------------");
  let errTimes = 100;
  let timestamp = Infinity;
  let mobile = "";
  let ciphertext = "";
  let headers: any = {};
  const post = (url: string, reqBody: string) =>
    new Promise<{ code: number; msg: string; data: any }>(r =>
      https
        .request(
          `https://${addresses || "39.108.92.148"}` + url,
          {
            method: "POST",
            headers: {
              ...headers,
              cookie: Object.entries(cookieObj)
                .map(arr => arr.join("="))
                .join(";"),
              "app-timestamp": String(timestamp),
            },
          },
          async res => {
            if (Array.isArray(res.headers["set-cookie"])) {
              for (let cookie of res.headers["set-cookie"]) {
                setCookie(cookie.substring(0, cookie.indexOf(";")));
              }
            }
            r(JSON.parse(String(await recvAll(res))) || {});
          }
        )
        .end(reqBody)
    );
  const rob = async (id: string, requestid: string) => {
    if (!cookieObj.sid) {
      console.log("未代理到域名nswtt.rim20.com，请重启微信再试一次");
      return;
    }
    if (!mobile) {
      console.log("未获取到手机号");
      return;
    }
    if (!timestamp) {
      console.log("timestamp为空");
      return;
    }

    ciphertext = ciphertext || getCiphertext(mobile, timestamp);
    const data = await post(
      `/api/wtt/coupon/rush/asyncrush?requestid=${requestid}`,
      JSON.stringify({
        activityid: "cfgguh5mdpudod868t3g",
        activityname: "2023体育消费券",
        position,
        location: {
          nation: "中国",
          adcode: "440305",
          province: "广东省",
          city: "深圳市",
          citycode: "156440300",
          district: "南山区",
          township: "粤海街道",
          address: "广东省深圳市南山区滨海大道",
          position,
          decode: 200,
          isok: true,
        },
        id,
        batchid: id,
        ciphertext,
        mobile,
        issafekey: 200,
        channel: "wx9f30f1cea85e1e8c",
      })
    );
    console.log(
      getDate().toLocaleTimeString(),
      "抢券结果:",
      data.code,
      data.code === 0 ? (data?.data?.batchid ? "成功" : "排队中") : data.msg
    );

    if (!errTimes--) {
      console.log("失败次数过多");
      process.exit(1);
    }

    /** 如果“输入有误,请重新输入”会重新生成密钥 */
    if (data.code === 300006) {
      ciphertext = getCiphertext(mobile, timestamp);
      rob(id, getRequestid());
      return;
    }

    /** 如果“该场券已被抢光了～”或者“同一用户每周只能获取1张券”就结束 */
    /** 不成功就更新Requestid再来一次 */
    if (data.code !== 300001 && data.code !== 300002 && !data?.data?.batchid) {
      setTimeout(() => rob(id, data.code === 0 ? requestid : getRequestid()), 200);
      return;
    }

    taskSet.delete(id);
    if (taskSet.size === 0) {
      console.log("全部抢劵任务完成，脚本3秒后自动退出");
      setTimeout(() => process.exit(0), 3000);
    }
  };

  const robPlace = async (req: any) => {
    const id = MD5(JSON.stringify(req));
    for (let err = 0; err < 10; err++) {
      let couponrecordid = "";
      let payeeconfigid = "";
      for (let i = 0; i < 10; i++) {
        const check = await post(`/api/wtt/sport/order/check`, JSON.stringify(req));
        couponrecordid = (check?.data?.couponrecords || []).sort(
          (a, b) => new Date(a.validendtime).getTime() - new Date(b.validendtime).getTime()
        )[0]?.id;
        payeeconfigid = (check?.data?.payeelist || [])[0]?.payeeconfigid;
        console.log("第", i + 1, "次获取优惠券id", couponrecordid, "订单id", payeeconfigid);
        if (couponrecordid && payeeconfigid) break;
      }
      await new Promise<void>(r => setTimeout(() => r(), 200));
      /** 新建订单 */
      const { code, data, msg } = await post(
        "/api/wtt/sport/order/add",
        JSON.stringify({
          appid: "wx9f30f1cea85e1e8c",
          channel: "wx9f30f1cea85e1e8c",
          payscene: "PS_WX_MP",
          tradetype: "JSAPI",
          projectid: req.projectid,
          slicedate: req.slicedate,
          totalprice: req.totalprice,
          payprice: req.payprice,
          paytype: req.paytype,
          slicelist: req.slicelist,
          playerids: "",
          location: req.location,
          couponrecordid,
          payeeconfigid,
        })
      );
      console.log(
        getDate().toLocaleTimeString(),
        "抢券结果:",
        code,
        code === 0 ? (data?.mchid ? "成功" : "排队中") : msg
      );
      if (code === 0 && data?.mchid) {
        taskSet.delete(id);
        return;
      }
    }
    console.log("失败次数过多");
  };

  const saleDateMap = new Map<string, number>();
  new HttpProxy(["nswtt.rim20.com", "nswtt-static.rim20.com"], { proxyMode: new DnsServer() })
    .addProxyRule(
      (method, url, headers) => url.pathname.includes("thematiclist"),
      async function* (localReq) {
        const remoteReq: Partial<IHttpProxyReq> = {};
        const remoteRes = yield remoteReq;
        try {
          const now = getDate().getTime() / 1000;
          const body: object = JSON.parse(String(remoteRes.body));
          if (timestamp === Infinity && Array.isArray(body)) {
            const filter = body
              .map(obj => {
                const date = new Date(obj.issuestarttime);
                const time = date.getTime() / 1000;
                if (time > now && (date.getHours() === 10 || date.getHours() === 15)) {
                  timestamp = Math.min(timestamp, time);
                }
                return { ...obj, time };
              })
              .filter(({ time }) => time === timestamp);

            for (const { id, issuestarttime, name } of filter) {
              if (!taskSet.has(id) && timestamp === new Date(issuestarttime).getTime() / 1000) {
                const timeout = new Date(issuestarttime).getTime() + 100 - getDate().getTime();
                if (timeXC === null) {
                  console.log("没代理到域名，请退出电脑微信重新登录");
                  return;
                }
                if (timeout > 0) {
                  if (!mobile) {
                    console.log(
                      "未获取到手机号，请手动点击小程序主页右下方“我的”，脚本会自动获取手机号。若依然无法获取请退出电脑微信重新登录"
                    );
                    timestamp = Infinity;
                    return;
                  }
                  taskSet.add(id);
                  const msg = `将在${(timeout / 1000).toFixed(1)}秒后自动帮你抢【${name}】`;
                  console.log(msg);
                  setTimeout(() => rob(id, getRequestid()), timeout);
                }
              }
            }
          }
          const localRes: Partial<IHttpProxyRes> = { body: JSON.stringify(body) };
          return localRes;
        } catch (e) {
          console.error(e);
        }
        return {};
      }
    )
    .addProxyRule(
      (method, url) => url.pathname === "/api/wtt/sport/order/check",
      async function* (localReq) {
        try {
          const req = JSON.parse(String(localReq.body)) || {};
          const time = saleDateMap.get(req.slicedate);
          const now = getDate().getTime();
          // setTimeout(() => robPlace(req), 10);
          // if (1) throw new Error("t");
          if (time && time > now) {
            const timeout = time - now;
            const id = MD5(JSON.stringify(req));
            let msg = `将在${(timeout / 1000).toFixed(1)}秒后自动帮你抢场地`;
            if (taskSet.has(id)) {
              msg = "已存在相同的抢券任务";
            } else {
              setTimeout(() => robPlace(req), timeout);
              console.log(`将在${new Date(time).toLocaleString()}（${(timeout / 1000).toFixed(1)}秒后）自动帮你抢场地`);
              taskSet.add(id);
              // console.log(String((yield {}).body));
              // return {};
            }
            yield null;
            return {
              body: JSON.stringify({
                code: 1,
                msg,
                data: null,
              }),
            };
          }
        } catch (e) {
          console.log(e);
        }
        yield {};
        return {};
      }
    )
    .addProxyRule(
      (method, url, headers) => url.host === "nswtt.rim20.com",
      async function* (localReq) {
        headers = { ...localReq.headers };
        if (localReq.headers.cookie) {
          localReq.headers.cookie.split(";").forEach(setCookie);
        }
        const remoteReq = {};
        if (!mobile) {
          localReq.headers.cookie = "";
        }
        const remoteRes = yield remoteReq;
        const localRes: Partial<IHttpProxyRes> = {};
        try {
          const obj = JSON.parse(String(remoteRes.body)) || {};
          switch (localReq.url.pathname) {
            case "/api/wtt/system/time":
              //   console.log(obj.data.time);
              if (obj.data.time) {
                if (timeXC === null) {
                  console.log("电脑与服务器相差", obj.data.time - Math.floor(new Date().getTime() / 1000), "秒");
                }
                timeXC = obj.data.time - Math.floor(new Date().getTime() / 1000);
              }
              return {};
            case "/api/wtt/user/wttauth/login":
              if (obj.data.mobile) {
                mobile = obj.data.mobile;
                console.log("获取到手机号:", mobile);
              }
              return {};
            case "/api/wtt/sport/calendar/list":
              if (Array.isArray(obj?.data?.list)) {
                saleDateMap.clear();
                for (const info of obj.data.list) {
                  if (info.issale === 100) {
                    saleDateMap.set(info.slicedate, new Date(info.saletime).getTime());
                    info.saletime = info.addtime;
                    info.issale = 200;
                  }
                }
                // console.log("修改成功");
                localRes.body = JSON.stringify(obj);
              }
              break;
            case "/api/wtt/sport/slice/list":
              if (
                saleDateMap.has(String(localReq.url.searchParams.get("slicedate") || "").trim()) &&
                Array.isArray(obj?.data?.slicelist)
              ) {
                for (const info of obj.data.slicelist) {
                  info.status = 200;
                }
                localRes.body = JSON.stringify(obj);
              }
              break;

            // case "/api/wtt/sport/order/check":
          }
        } catch (e) {
          console.log(e);
        }
        // console.log(
        //   Object.entries(cookieObj)
        //     .map(arr => arr.join("="))
        //     .join(";")
        // );
        // localReq.url.pathname === "/api/wtt/system/time" ||
        //   saveLog.add({
        //     localReq: { ...localReq, body: String(localReq.body) },
        //     remoteReq,
        //     localRes,
        //     remoteRes: { ...remoteRes, body: String(remoteRes.body) },

        //     time: new Date().toLocaleString(),
        //   });

        return localRes;
      }
    );
});
