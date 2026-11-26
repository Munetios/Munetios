/*
 * Munetios global locales. Every Munetios and Ganetios app offers exactly these languages.
 * resolve() maps any browser or saved language tag onto one of them.
 *
 * Regional conventions the catalogs follow:
 *   en-US "Couldn't …"            en-GB "Could not …", British spelling
 *   es-419 / es-US  Configuración, Home page = Principal     es-ES  Ajustes, Home page = Inicio
 *   Home as a personal house = Casa in every Spanish locale
 *   pt-BR  Buscar, Configurações  pt-PT  Pesquisar, Ajustes
 */
(() => {
  "use strict";
  const LOCALES = Object.freeze([
    { code: "en-US", name: "English (United States)", base: "en", dir: "ltr" },
    { code: "en-GB", name: "English (United Kingdom)", base: "en", dir: "ltr" },
    { code: "es-419", name: "Español (Latinoamérica)", base: "es", dir: "ltr" },
    { code: "es-ES", name: "Español (España)", base: "es", dir: "ltr" },
    { code: "es-US", name: "Español (Estados Unidos)", base: "es", dir: "ltr" },
    { code: "fr-FR", name: "Français (France)", base: "fr", dir: "ltr" },
    { code: "fr-CA", name: "Français (Canada)", base: "fr", dir: "ltr" },
    { code: "de", name: "Deutsch", base: "de", dir: "ltr" },
    { code: "it", name: "Italiano", base: "it", dir: "ltr" },
    { code: "pt-BR", name: "Português (Brasil)", base: "pt", dir: "ltr" },
    { code: "pt-PT", name: "Português (Portugal)", base: "pt", dir: "ltr" },
    { code: "zh-CN", name: "中文（简体）", base: "zh", dir: "ltr" },
    { code: "zh-TW", name: "中文（繁體）", base: "zh", dir: "ltr" },
    { code: "ko", name: "한국어", base: "ko", dir: "ltr" },
    { code: "ar", name: "العربية", base: "ar", dir: "rtl" },
    { code: "hi", name: "हिन्दी", base: "hi", dir: "ltr" },
    { code: "co", name: "Corsu", base: "co", dir: "ltr" },
  ]);
  const CODES = LOCALES.map((l) => l.code);
  const BY_CODE = Object.fromEntries(LOCALES.map((l) => [l.code.toLowerCase(), l]));

  // English that keeps "Couldn't" and US spelling; every other English region uses en-GB.
  const US_ENGLISH = new Set(["", "us", "ca", "ph", "pr", "um", "as", "gu", "vi", "mp"]);
  const PORTUGAL = new Set(["pt", "ao", "mz", "cv", "gw", "st", "tl", "mo", "gq", "ch", "lu"]);
  const TRADITIONAL = new Set(["tw", "hk", "mo", "hant"]);

  function resolve(tag) {
    if (!tag || typeof tag !== "string" || tag === "auto") return null;
    const parts = tag.replace(/_/g, "-").toLowerCase().split("-");
    const base = parts[0];
    const rest = parts.slice(1);
    const region = rest.find((p) => /^([a-z]{2}|\d{3})$/.test(p)) || "";
    const script = rest.find((p) => /^[a-z]{4}$/.test(p)) || "";
    const exact = BY_CODE[tag.replace(/_/g, "-").toLowerCase()];
    if (exact) return exact.code;
    switch (base) {
      case "en": return US_ENGLISH.has(region) ? "en-US" : "en-GB";
      case "es": return region === "es" || (!region && !script) ? "es-ES" : region === "us" ? "es-US" : "es-419";
      case "fr": return region === "ca" ? "fr-CA" : "fr-FR";
      case "pt": return PORTUGAL.has(region) ? "pt-PT" : "pt-BR";
      case "zh": return TRADITIONAL.has(script) || TRADITIONAL.has(region) ? "zh-TW" : "zh-CN";
      case "de": case "gsw": return "de";
      case "it": return "it";
      case "ko": return "ko";
      case "ar": return "ar";
      case "hi": return "hi";
      case "co": return "co";
      default: return null;
    }
  }

  function detect(list) {
    const tags = list || (typeof navigator !== "undefined" ? (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) : []);
    for (const tag of tags) { const code = resolve(tag); if (code) return code; }
    return "en-US";
  }

  // Locale chain from most to least specific: e.g. es-US → es-US, es-419, es, en-US, en.
  function chain(code) {
    const c = resolve(code) || "en-US";
    const base = BY_CODE[c.toLowerCase()].base;
    const out = [c];
    if (c === "es-US") out.push("es-419");
    if (c === "fr-CA") out.push("fr-FR");
    if (c === "en-GB") out.push("en-US");
    if (c === "zh-TW") out.push("zh-Hant");
    out.push(base);
    if (c === "pt-PT") out.push("pt-BR");
    if (base !== "en") out.push("en-US");
    out.push("en");
    return [...new Set(out)];
  }

  // British English: "Couldn't" → "Could not", US spellings → British.
  const GB_WORDS = [["Couldn't", "Could not"], ["couldn't", "could not"], ["Color", "Colour"], ["color", "colour"], ["Favorites", "Favourites"], ["favorites", "favourites"], ["Favorite", "Favourite"], ["favorite", "favourite"], ["Kilometers", "Kilometres"], ["kilometers", "kilometres"], ["Center", "Centre"], ["center", "centre"], ["Organize", "Organise"], ["organize", "organise"], ["Customize", "Customise"], ["customize", "customise"], ["Canceled", "Cancelled"], ["canceled", "cancelled"], ["Gray", "Grey"], ["gray", "grey"], ["Analyze", "Analyse"], ["analyze", "analyse"], ["Recognize", "Recognise"], ["recognize", "recognise"], ["Synchronize", "Synchronise"], ["synchronize", "synchronise"], ["Behavior", "Behaviour"], ["behavior", "behaviour"], ["Catalog", "Catalogue"], ["catalog", "catalogue"], ["Dialog", "Dialogue"]];
  function toBritish(text) {
    if (typeof text !== "string") return text;
    let out = text;
    for (const [us, gb] of GB_WORDS) out = out.replace(new RegExp(`(?<![\\p{L}])${us}(?![\\p{L}])`, "gu"), gb);
    return out;
  }
  function britishCatalog(catalog) {
    const out = {};
    for (const [k, v] of Object.entries(catalog || {})) { const gb = toBritish(v); if (gb !== v) out[k] = gb; }
    return out;
  }

  // pt-BR search wording ("Pesquisar" → "Buscar").
  function toBrazilianSearch(text) {
    if (typeof text !== "string") return text;
    return text.replace(/Pesquisar/g, "Buscar").replace(/pesquisar/g, "buscar").replace(/Pesquisando/g, "Buscando").replace(/pesquisando/g, "buscando")
      .replace(/Pesquise/g, "Busque").replace(/pesquise/g, "busque").replace(/Pesquisas/g, "Buscas").replace(/pesquisas/g, "buscas").replace(/Pesquisa/g, "Busca").replace(/pesquisa/g, "busca");
  }
  // pt-PT settings wording ("Configurações"/"Definições" → "Ajustes").
  function toPortugalSettings(text) {
    if (typeof text !== "string") return text;
    return text.replace(/Configurações/g, "Ajustes").replace(/configurações/g, "ajustes").replace(/Definições/g, "Ajustes").replace(/definições/g, "ajustes")
      .replace(/\bas ajustes/g, "os ajustes").replace(/\bdas ajustes/g, "dos ajustes").replace(/\bsuas ajustes/g, "seus ajustes").replace(/\bàs ajustes/g, "aos ajustes").replace(/\bnas ajustes/g, "nos ajustes");
  }
  // pt-PT vocabulary (Brazilian → European Portuguese), plus Ajustes and Pesquisar.
  const PT_WORDS = [
    ["Configurações", "Ajustes"], ["configurações", "ajustes"], ["Definições", "Ajustes"], ["definições", "ajustes"],
    ["Arquivos", "Ficheiros"], ["arquivos", "ficheiros"], ["Arquivo", "Ficheiro"], ["arquivo", "ficheiro"], ["Lixeira", "Lixo"], ["lixeira", "lixo"],
    ["Usuários", "Utilizadores"], ["usuários", "utilizadores"], ["Usuário", "Utilizador"], ["usuário", "utilizador"],
    ["Aplicativos", "Aplicações"], ["aplicativos", "aplicações"], ["Aplicativo", "Aplicação"], ["aplicativo", "aplicação"],
    ["Telas", "Ecrãs"], ["telas", "ecrãs"], ["Tela", "Ecrã"], ["tela", "ecrã"], ["Senha", "Palavra-passe"], ["senha", "palavra-passe"],
    ["Salvando", "A guardar"], ["salvando", "a guardar"], ["Salvar", "Guardar"], ["salvar", "guardar"], ["Salve", "Guarde"], ["salve", "guarde"],
    ["Salvos", "Guardados"], ["salvos", "guardados"], ["Salvas", "Guardadas"], ["salvas", "guardadas"], ["Salvo", "Guardado"], ["salvo", "guardado"], ["Salva", "Guardada"], ["salva", "guardada"],
    ["Carregando", "A carregar"], ["carregando", "a carregar"], ["Enviando", "A enviar"], ["enviando", "a enviar"], ["Baixando", "A transferir"], ["baixando", "a transferir"], ["Baixar", "Transferir"], ["baixar", "transferir"],
    ["Buscando", "A pesquisar"], ["buscando", "a pesquisar"], ["Pesquisando", "A pesquisar"], ["pesquisando", "a pesquisar"], ["Buscar", "Pesquisar"], ["buscar", "pesquisar"], ["Busque", "Pesquise"], ["busque", "pesquise"], ["Busca", "Pesquisa"], ["busca", "pesquisa"],
    ["Procurando", "A procurar"], ["procurando", "a procurar"], ["Calculando", "A calcular"], ["calculando", "a calcular"], ["Excluindo", "A eliminar"], ["excluindo", "a eliminar"],
    ["Compartilhamento", "Partilha"], ["compartilhamento", "partilha"], ["Compartilhar", "Partilhar"], ["compartilhar", "partilhar"], ["Compartilhe", "Partilhe"], ["compartilhe", "partilhe"], ["Compartilhado", "Partilhado"], ["compartilhado", "partilhado"],
    ["Excluir", "Eliminar"], ["excluir", "eliminar"], ["Exclua", "Elimine"], ["exclua", "elimine"], ["Excluídos", "Eliminados"], ["excluídos", "eliminados"], ["Excluídas", "Eliminadas"], ["excluídas", "eliminadas"], ["Excluído", "Eliminado"], ["excluído", "eliminado"], ["Excluída", "Eliminada"], ["excluída", "eliminada"],
    ["Ônibus", "Autocarro"], ["ônibus", "autocarro"], ["Trem", "Comboio"], ["trem", "comboio"], ["Celular", "Telemóvel"], ["celular", "telemóvel"], ["Mouse", "Rato"], ["Cadastrar", "Registar"], ["cadastrar", "registar"],
    ["Registrar", "Registar"], ["registrar", "registar"], ["Contato", "Contacto"], ["contato", "contacto"], ["Contatos", "Contactos"], ["contatos", "contactos"],
    ["Você pode", "Pode"], ["você pode", "pode"], ["Você deseja", "Pretende"], ["você deseja", "pretende"], ["Você tem", "Tem"], ["você tem", "tem"], ["Você não", "Não"], ["você não", "não"], ["Você está", "Está"], ["você está", "está"],
    ["Backup", "Cópia de segurança"], ["backup", "cópia de segurança"],
    ["Faça login", "Inicie sessão"], ["faça login", "inicie sessão"], ["Fazer login", "Iniciar sessão"], ["fazer login", "iniciar sessão"], ["Faça logout", "Termine sessão"], ["faça logout", "termine sessão"], ["visitante", "convidado"], ["Visitante", "Convidado"], ["equipe", "equipa"], ["Equipe", "Equipa"],
  ];
  function toEuropeanPortuguese(text) {
    if (typeof text !== "string") return text;
    let out = text;
    for (const [br, pt] of PT_WORDS) out = out.replace(new RegExp(`(?<![\\p{L}])${br}(?![\\p{L}])`, "gu"), pt);
    return out.replace(/\bas ajustes/g, "os ajustes").replace(/\bdas ajustes/g, "dos ajustes").replace(/\bsuas ajustes/g, "os seus ajustes").replace(/\bàs ajustes/g, "aos ajustes").replace(/\bnas ajustes/g, "nos ajustes")
      .replace(/\ba lixo/g, "o lixo").replace(/\bda lixo/g, "do lixo").replace(/\bna lixo/g, "no lixo").replace(/\bo cópia de segurança/g, "a cópia de segurança").replace(/\bum cópia de segurança/g, "uma cópia de segurança");
  }
  // zh-CN → zh-TW: Taiwan vocabulary first, then Simplified → Traditional characters.
  const TW_PHRASES = [
    ["应用程序", "應用程式"], ["文件夹", "資料夾"], ["电子邮件", "電子郵件"], ["用户名", "使用者名稱"], ["服务器", "伺服器"], ["剪贴板", "剪貼簿"], ["标签页", "分頁"], ["互联网", "網際網路"], ["端到端", "端對端"], ["二维码", "QR 圖碼"], ["幻灯片", "投影片"], ["分辨率", "解析度"],
    ["设备", "裝置"], ["软件", "軟體"], ["硬件", "硬體"], ["信息", "資訊"], ["消息", "訊息"], ["短信", "簡訊"], ["网络", "網路"], ["默认", "預設"], ["设置", "設定"], ["视频", "影片"], ["文件", "檔案"], ["打印", "列印"], ["搜索", "搜尋"], ["用户", "使用者"], ["程序", "程式"], ["屏幕", "螢幕"], ["全屏", "全螢幕"],
    ["鼠标", "滑鼠"], ["登录", "登入"], ["注销", "登出"], ["账户", "帳戶"], ["账号", "帳號"], ["保存", "儲存"], ["粘贴", "貼上"], ["菜单", "選單"], ["窗口", "視窗"], ["数据", "資料"], ["支持", "支援"], ["质量", "品質"], ["链接", "連結"], ["导出", "匯出"], ["导入", "匯入"],
    ["加载", "載入"], ["刷新", "重新整理"], ["撤销", "復原"], ["光标", "游標"], ["字体", "字型"], ["照片", "相片"], ["相册", "相簿"], ["视图", "檢視"], ["激活", "啟用"], ["禁用", "停用"], ["博客", "部落格"], ["打开", "開啟"], ["创建", "建立"], ["新建", "新增"], ["添加", "新增"],
    ["内存", "記憶體"], ["缓存", "快取"], ["磁盘", "磁碟"], ["运行", "執行"], ["代码", "程式碼"], ["函数", "函式"], ["变量", "變數"], ["对象", "物件"], ["实时", "即時"], ["音频", "音訊"], ["在线", "線上"], ["离线", "離線"], ["自定义", "自訂"], ["获取", "取得"], ["演示", "簡報"],
    ["复制", "複製"], ["重复", "重複"], ["复杂", "複雜"], ["复选", "複選"], ["复印", "影印"], ["回复", "回覆"], ["日历", "日曆"], ["制作", "製作"], ["制造", "製造"], ["头发", "頭髮"], ["干净", "乾淨"], ["干燥", "乾燥"], ["干预", "干預"], ["关系", "關係"], ["联系", "聯絡"],
    ["宽松", "寬鬆"], ["放松", "放鬆"], ["松开", "鬆開"], ["周围", "周圍"], ["尽管", "儘管"], ["尽量", "儘量"], ["收获", "收穫"], ["采用", "採用"], ["采集", "採集"], ["游戏", "遊戲"], ["旅游", "旅遊"], ["台风", "颱風"], ["面条", "麵條"], ["只读", "唯讀"],
  ];
  const S2T_PAIRS = "账帳单單录錄无無为為设設备備暂暫开開启啟区區个個换換没沒输輸码碼数數据據关關闭閉们們处處请請检檢后後试試败敗于於联聯网網语語浅淺题題资資隐隱称稱显顯电電邮郵载載确確两兩读讀这這复復浏瀏览覽统統让讓该該间間观觀动動将將传傳删刪从從务務时時并並创創吗嗎认認导導档檔写寫选選择擇过過图圖头頭验驗证證钥鑰应應继繼续續户戶云雲储儲满滿项項辑輯编編视視频頻单單历歷体體连連许許标標签籤页頁长長钟鐘紧緊凑湊适適响響类類别別现現计計划劃仅僅帐帳发發络絡扫掃维維旧舊尝嘗经經锁鎖测測笔筆侧側边邊栏欄专專办辦节節岁歲结結进進详詳里裡叠疊义義点點链鏈对對说說颜顏须須谁誰礼禮运運协協访訪问問权權规規属屬国國随隨预預宽寬转轉尔爾绘繪调調锐銳颗顆强強变變范範围圍丰豐阴陰钢鋼涂塗绝絕离離约約机機库庫忆憶册冊归歸实實顾顧贴貼滤濾评評摄攝优優组組灯燈欢歡张張错錯误誤识識释釋镜鏡饱飽鲜鮮艳豔怀懷戏戲剧劇块塊缩縮质質较較顶頂护護气氣报報获獲风風觉覺湿濕热熱际際阵陣压壓稳穩极極见見欧歐险險亏虧阳陽盖蓋领領严嚴轻輕黄黃纬緯东東状狀雾霧冻凍态態飘飄华華给給级級带帶顺順筛篩条條迟遲毕畢达達绪緒红紅绿綠蓝藍纯純议議课課总總战戰阅閱帮幫购購汇匯饪飪营營坚堅骤驟谱譜减減厨廚纸紙买買荐薦广廣拦攔静靜环環织織队隊击擊虚虛拟擬滚滾弹彈乐樂装裝马馬荧螢铅鉛书書销銷脚腳齐齊决決谨謹术術财財软軟职職产產执執坏壞补補团團损損乱亂词詞渐漸挂掛饰飾轴軸圆圓润潤倾傾饼餅货貨币幣积積扩擴缘緣细細税稅额額负負责責绩績赖賴阶階审審举舉诉訴么麼扰擾论論胁脅违違钓釣鱼魚诈詐骗騙恶惡谢謝询詢监監闻聞赛賽车車听聽讨討卫衛鸦鴉庆慶贪貪简簡钮鈕兰蘭罗羅习習饭飯鸡雞层層陆陸内內会會员員当當记記夹夾画畫双雙话話种種况況与與键鍵盘盤线線来來拥擁占佔还還余餘准準温溫几幾昼晝晓曉麦麥养養饮飲独獨业業学學辅輔终終竖豎样樣悬懸则則骚騷游遊踪蹤万萬圣聖周週爱愛径徑讯訊杂雜断斷缓緩讲講译譯谈談订訂闪閃针針铃鈴钱錢轮輪飞飛驾駕门門费費赞讚练練纪紀诊診闹鬧鸟鳥龙龍岛島园園场場厅廳块塊坛壇声聲处處备備复復够夠头頭奋奮妈媽孙孫宁寧宝寶实實审審宪憲对對寻尋导導寿壽尽盡层層届屆属屬岁歲币幣师師帐帳帮幫库庫废廢开開异異弃棄张張弯彎录錄彻徹忆憶态態总總恋戀悦悅惊驚惯慣战戰执執扩擴扫掃扬揚扰擾抢搶护護报報担擔拟擬拣揀择擇挤擠挥揮损損换換据據摆擺摇搖携攜敌敵数數斗鬥无無时時旷曠显顯晒曬暂暫术術朴樸杀殺杂雜权權杨楊极極构構枪槍档檔桥橋梦夢检檢楼樓欢歡残殘毁毀气氣汉漢汤湯沟溝没沒泽澤洁潔浅淺测測济濟浏瀏涨漲渊淵温溫湾灣湿濕满滿滚滾灭滅灵靈灾災炉爐点點烂爛热熱爷爺牵牽状狀犹猶猫貓献獻环環现現电電画畫畅暢疗療疯瘋皱皺盐鹽监監盖蓋盘盤着著矿礦码碼础礎硕碩确確础礎离離种種积積称稱稳穩穷窮窃竊竞競笋筍签簽简簡类類粮糧紧緊纳納纵縱纷紛终終绍紹经經绑綁绕繞绘繪绝絕统統继繼绩績续續综綜缓緩缝縫缠纏罚罰罢罷职職联聯聪聰肃肅肤膚胆膽胜勝脑腦脸臉舍捨舰艦艺藝节節苏蘇药藥获獲莱萊虑慮虫蟲虽雖蚁蟻补補衬襯袭襲装裝觅覓觉覺触觸誉譽计計订訂认認讨討让讓训訓议議讯訊记記讲講许許论論设設访訪证證评評识識诉訴诊診词詞译譯试試诗詩诚誠话話询詢该該详詳语語误誤说說请請诸諸读讀课課谁誰调調谈談谋謀谓謂谢謝谷谷貌貌贝貝负負贡貢财財责責贤賢败敗货貨质質购購贯貫贴貼贵貴贸貿费費贺賀资資赏賞赔賠赚賺赛賽赵趙趋趨跃躍践踐轨軌转轉轮輪软軟轻輕载載较較辅輔辆輛辈輩辉輝输輸辞辭边邊达達迁遷过過运運还還这這进進远遠违違连連迟遲选選递遞逻邏遗遺邮郵邻鄰酱醬释釋针針钟鐘钢鋼钥鑰钱錢铁鐵铺鋪链鏈销銷锁鎖锅鍋错錯键鍵镇鎮长長门門闭閉问問闲閒间間闻聞阅閱队隊阳陽阴陰际際陆陸陈陳险險随隨隐隱难難雾霧须須顶頂项項顺順顾顧预預领領频頻题題颜顏额額风風飞飛饭飯饮飲饰飾饱飽馆館驱驅验驗骤驟鱼魚鲁魯鸣鳴鸭鴨麦麥黄黃齐齊龄齡";
  const S2T = new Map();
  for (let i = 0; i + 1 < S2T_PAIRS.length; i += 2) S2T.set(S2T_PAIRS[i], S2T_PAIRS[i + 1]);
  function toTraditional(text) {
    if (typeof text !== "string") return text;
    let out = text;
    for (const [s, t] of TW_PHRASES) out = out.split(s).join(t);
    let res = "";
    for (const ch of out) res += S2T.get(ch) || ch;
    for (const [bad, good] of TW_FIXUPS) res = res.split(bad).join(good);
    return res;
  }
  // Characters whose Traditional form depends on the word.
  const TW_FIXUPS = [["公裡", "公里"], ["英裡", "英里"], ["裡程", "里程"], ["千裡", "千里"], ["遊標", "游標"], ["遊泳", "游泳"], ["週圍", "周圍"], ["週邊", "周邊"], ["週期", "週期"], ["標簽", "標籤"], ["書簽", "書籤"], ["批準", "批准"], ["準許", "准許"], ["鐘錶", "鐘錶"], ["乾預", "干預"], ["瞭解", "了解"], ["著作", "著作"], ["著名", "著名"], ["隻有", "只有"], ["顯著", "顯著"], ["接著", "接著"], ["正著", "正著"]];

  // Spanish: Latin America ↔ Spain.
  const ES_ES = [["Configuración", "Ajustes"], ["configuración", "ajustes"], ["Agregar", "Añadir"], ["agregar", "añadir"], ["Agrega", "Añade"], ["agrega", "añade"], ["Agregue", "Añada"], ["agregue", "añada"], ["Agregado", "Añadido"], ["agregado", "añadido"], ["Agregada", "Añadida"], ["agregada", "añadida"], ["Agregados", "Añadidos"], ["agregados", "añadidos"], ["Agregadas", "Añadidas"], ["agregadas", "añadidas"], ["Agregando", "Añadiendo"], ["agregando", "añadiendo"],
    ["computadora", "ordenador"], ["Computadora", "Ordenador"], ["celular", "móvil"], ["Celular", "Móvil"], ["Videos", "Vídeos"], ["videos", "vídeos"], ["Video", "Vídeo"], ["video", "vídeo"], ["Estacionamiento", "Aparcamiento"], ["estacionamiento", "aparcamiento"], ["Pegar", "Pegar"]];
  const ES_419 = [["Ajustes", "Configuración"], ["ajustes", "configuración"], ["Añadir", "Agregar"], ["añadir", "agregar"], ["Añade", "Agrega"], ["añade", "agrega"], ["Añada", "Agregue"], ["añada", "agregue"], ["Añadido", "Agregado"], ["añadido", "agregado"], ["Añadida", "Agregada"], ["añadida", "agregada"], ["Añadidos", "Agregados"], ["añadidos", "agregados"], ["Añadidas", "Agregadas"], ["añadidas", "agregadas"], ["Añadiendo", "Agregando"], ["añadiendo", "agregando"],
    ["ordenador", "computadora"], ["Ordenador", "Computadora"], ["Vídeos", "Videos"], ["vídeos", "videos"], ["Vídeo", "Video"], ["vídeo", "video"], ["Aparcamiento", "Estacionamiento"], ["aparcamiento", "estacionamiento"]];
  const replaceWords = (text, pairs) => {
    if (typeof text !== "string") return text;
    let out = text;
    for (const [a, b] of pairs) out = out.replace(new RegExp(`(?<![\\p{L}])${a}(?![\\p{L}])`, "gu"), b);
    return out;
  };
  const toPeninsularSpanish = (text) => replaceWords(text, ES_ES).replace(/\blas ajustes\b/g, "los ajustes").replace(/\bLa ajustes\b/g, "Los ajustes").replace(/\bla ajustes\b/g, "los ajustes").replace(/\btu ajustes\b/g, "tus ajustes").replace(/\bde la ajustes\b/g, "de los ajustes");
  const toLatinAmericanSpanish = (text) => replaceWords(text, ES_419).replace(/\blos configuración\b/g, "la configuración").replace(/\bLos configuración\b/g, "La configuración").replace(/\btus configuración\b/g, "tu configuración");
  // fr-FR → fr-CA (Office québécois de la langue française usage).
  const FR_CA = [["e-mails", "courriels"], ["e-mail", "courriel"], ["E-mails", "Courriels"], ["E-mail", "Courriel"], ["week-end", "fin de semaine"], ["week-ends", "fins de semaine"], ["Week-end", "Fin de semaine"], ["Parking", "Stationnement"], ["parking", "stationnement"], ["tchat", "clavardage"], ["Tchat", "Clavardage"], ["podcast", "balado"], ["podcasts", "balados"], ["Podcast", "Balado"], ["Podcasts", "Balados"]];
  const toCanadianFrench = (text) => replaceWords(text, FR_CA);

  // Look up a locale in a catalog under its usual spellings.
  const ALIASES = {
    "en-US": ["en-US", "en_US", "en-us", "en"], "en-GB": ["en-GB", "en_GB", "en-gb"],
    "es-419": ["es-419", "es_419"], "es-ES": ["es-ES", "es_ES", "es-es"], "es-US": ["es-US", "es_US", "es-us"],
    "fr-FR": ["fr-FR", "fr_FR", "fr-fr", "fr"], "fr-CA": ["fr-CA", "fr_CA", "fr-ca"], de: ["de", "de-DE", "de_DE"], it: ["it", "it-IT", "it_IT"],
    "pt-BR": ["pt-BR", "pt_BR", "pt-br"], "pt-PT": ["pt-PT", "pt_PT", "pt-pt"], "zh-CN": ["zh-CN", "zh_CN", "zh-cn", "zh", "zh-Hans"], "zh-TW": ["zh-TW", "zh_TW", "zh-tw", "zh-Hant", "zh-hant"],
    ko: ["ko", "ko-KR"], ar: ["ar", "ar-SA"], hi: ["hi", "hi-IN"], co: ["co", "co-FR"],
  };
  const HOME_KEY = /home/i;
  /*
   * compose(catalog, extras, opts) → { "en-US": {...}, …17 codes }.
   * catalog: { locale: {key: text} } in any of the usual spellings. extras: authored strings per code.
   * opts.es: "ES" or "419" says what a bare "es" means (default "419"); opts.pt: "BR" or "PT" for a bare "pt" (default "BR").
   * Missing regional variants are derived (en-GB, es-ES/es-419/es-US, fr-CA, pt-PT/pt-BR, zh-TW) and the
   * Munetios wording rules are applied: en-GB "Could not", pt-BR Buscar, pt-PT Ajustes, es-ES Ajustes/Inicio,
   * es-419/es-US Configuración/Principal.
   */
  function compose(catalog, extras, opts) {
    extras = extras || {}; opts = opts || {};
    const find = (code) => {
      const names = ALIASES[code].slice();
      if (code === (opts.es === "ES" ? "es-ES" : "es-419")) names.push("es");
      if (code === (opts.pt === "PT" ? "pt-PT" : "pt-BR")) names.push("pt");
      for (const n of names) if (catalog[n] && typeof catalog[n] === "object") return catalog[n];
      return null;
    };
    const en = find("en-US") || {};
    const own = {};
    for (const code of CODES) own[code] = find(code);
    // Each code: English → its sibling's strings (converted) → its own strings → authored extras.
    // So gaps in a regional catalog are filled from the closest language before English.
    const SIBLING = { "es-ES": ["es-419", toPeninsularSpanish], "es-419": ["es-ES", toLatinAmericanSpanish], "es-US": ["es-419", (t) => t],
      "fr-CA": ["fr-FR", toCanadianFrench], "fr-FR": ["fr-CA", (t) => t], "pt-PT": ["pt-BR", toEuropeanPortuguese], "pt-BR": ["pt-PT", (t) => t], "zh-TW": ["zh-CN", toTraditional] };
    const layer = (code, seen = new Set()) => {
      if (seen.has(code)) return {};
      seen.add(code);
      const sib = SIBLING[code];
      const below = sib ? mapAll(layer(sib[0], seen), sib[1]) : {};
      return { ...below, ...(own[code] || {}), ...(extras[code] || {}) };
    };
    const out = {};
    for (const code of CODES) {
      let dict = { ...en };
      if (code === "en-GB") Object.assign(dict, britishCatalog(dict));
      Object.assign(dict, code === "en-US" ? extras[code] || {} : layer(code));
      if (code === "en-GB") Object.assign(dict, britishCatalog(dict));
      if (code === "pt-BR") Object.assign(dict, mapCatalog(dict, toBrazilianSearch));
      if (code === "pt-PT") Object.assign(dict, mapCatalog(dict, toPortugalSettings));
      if (code === "es-ES") for (const [k, v] of Object.entries(dict)) { if (typeof v !== "string") continue; let n = v.replace(/Configuración/g, "Ajustes").replace(/configuración/g, "ajustes"); if (HOME_KEY.test(k) && n === "Principal") n = "Inicio"; dict[k] = n; }
      if (code === "es-419" || code === "es-US") for (const [k, v] of Object.entries(dict)) { if (typeof v !== "string") continue; let n = replaceWords(v, [["Ajustes", "Configuración"], ["ajustes", "configuración"]]); if (HOME_KEY.test(k) && /^(Inicio|Página principal|Página de inicio)$/.test(n)) n = "Principal"; dict[k] = n; }
      out[code] = dict;
    }
    return out;
  }
  function mapAll(catalog, fn) {
    const out = {};
    for (const [k, v] of Object.entries(catalog || {})) out[k] = typeof v === "string" ? fn(v) : v;
    return out;
  }
  // Nested catalogs ({ buttons: { save: "Save" } }) ↔ flat keys ("buttons.save").
  function flat(obj, prefix = "", out = {}) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, prefix + k + ".", out);
      else out[prefix + k] = v;
    }
    return out;
  }
  function unflat(map) {
    const out = {};
    for (const [path, v] of Object.entries(map || {})) {
      const parts = path.split(".");
      let node = out;
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] = node[parts[i]] && typeof node[parts[i]] === "object" ? node[parts[i]] : {};
      node[parts[parts.length - 1]] = v;
    }
    return out;
  }
  // compose() for nested catalogs.
  function composeNested(catalog, extras, opts) {
    const flatCat = {}, flatExtras = {};
    for (const [k, v] of Object.entries(catalog || {})) if (v && typeof v === "object") flatCat[k] = flat(v);
    for (const [k, v] of Object.entries(extras || {})) if (v && typeof v === "object") flatExtras[k] = flat(v);
    const out = compose(flatCat, flatExtras, opts);
    for (const code of Object.keys(out)) out[code] = unflat(out[code]);
    return out;
  }
  // Objects from parallel KEYS + array rows (used by the array-based catalogs).
  const rows = (keys, list) => Object.fromEntries(keys.map((k, i) => [k, list[i]]).filter(([, v]) => v !== undefined));

  function mapCatalog(catalog, fn) {
    const out = {};
    for (const [k, v] of Object.entries(catalog || {})) { const next = fn(v); if (next !== v) out[k] = next; }
    return out;
  }

  window.MunetiosLocales = Object.freeze({ LOCALES, CODES, resolve, detect, chain, toBritish, britishCatalog, toBrazilianSearch, toPortugalSettings, toEuropeanPortuguese, toTraditional, toPeninsularSpanish, toLatinAmericanSpanish, toCanadianFrench, compose, composeNested, flat, unflat, rows, mapCatalog,
    name: (code) => (BY_CODE[String(resolve(code) || "").toLowerCase()] || {}).name || code,
    dir: (code) => (BY_CODE[String(resolve(code) || "").toLowerCase()] || {}).dir || "ltr" });
})();
