const SUPABASE_URL = "https://mpwspnccuaqyitwghqip.supabase.co";
const SUPABASE_KEY = "sb_publishable_lWeTQWJVlynCDmQWcdDSVQ_E0AfIJJX";
const PAGE_SIZE = 50;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  user: null,
  companies: [],
  customers: [],
  customerCompanies: [],
  cards: [],
  jobs: [],
  currentPage: 0,
  totalJobs: 0,
  invoicePage: 0,
  invoiceTotal: 0,
  reportCompanies: {},
  activePage: "dashboard",
  searchTimer: null,
  invoiceSearchTimer: null
};

const $ = id => document.getElementById(id);
const value = id => $(id).value.trim();
const selectedValues = id => [...$(id).options].filter(option => option.selected).map(option => option.value);
const esc = input => String(input ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const money = (amount, currency = "TL") => new Intl.NumberFormat("tr-TR", {style:"currency", currency: currency === "TL" ? "TRY" : currency, maximumFractionDigits:2}).format(Number(amount)||0);
const moneyTry = amount => money(amount, "TL");
const dateTR = d => d ? new Intl.DateTimeFormat("tr-TR").format(new Date(`${d}T00:00:00`)) : "-";
const dateTimeTR = d => d ? new Intl.DateTimeFormat("tr-TR",{dateStyle:"short",timeStyle:"short"}).format(new Date(d)) : "-";
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toast(message, type = "success") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.className = "toast", 3500);
}

function setBusy(button, busy, text = "İşleniyor...") {
  if (!button) return;
  if (busy) {
    button.dataset.oldText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.oldText || button.textContent;
    button.disabled = false;
  }
}

async function init() {
  bindEvents();
  const { data: { session } } = await db.auth.getSession();
  await applySession(session);
  db.auth.onAuthStateChange(async (_event, newSession) => applySession(newSession));
}

async function applySession(session) {
  state.user = session?.user || null;
  $("loginView").classList.toggle("hidden", !!state.user);
  $("appView").classList.toggle("hidden", !state.user);
  if (!state.user) return;
  $("userEmail").textContent = state.user.email || "Yetkili kullanıcı";
  try {
    await loadLookups();
    await Promise.all([loadDashboard(), checkLegacyDocuments()]);
  } catch (error) {
    handleError(error, "Sistem verileri yüklenemedi");
  }
}

function bindEvents() {
  $("loginForm").addEventListener("submit", login);
  $("logoutButton").addEventListener("click", () => db.auth.signOut());
  $("nav").addEventListener("click", e => {
    const page = e.target.closest("button")?.dataset.page;
    if (page) navigate(page);
  });
  document.addEventListener("click", e => {
    const page = e.target.closest("[data-go]")?.dataset.go;
    if (page) navigate(page);
  });
  $("menuButton").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  $("jobForm").addEventListener("submit", saveJob);
  $("cancelEditButton").addEventListener("click", resetJobForm);
  $("addCompanyButton").addEventListener("click", addCompanyFromForm);
  $("addCustomerButton").addEventListener("click", addCustomerFromForm);
  $("addCardButton").addEventListener("click", addCardFromForm);
  $("customerPageAdd").addEventListener("click", addCustomerFromPage);
  $("paymentMethod").addEventListener("change", toggleCardField);
  $("customerSearch").addEventListener("input", renderCustomerSearchResults);
  $("customerSearch").addEventListener("focus", renderCustomerSearchResults);
  $("customerCompanyOnly").addEventListener("change", renderCustomerSearchResults);
  $("companyId").addEventListener("change", renderCustomerSearchResults);
  $("customerListSearch").addEventListener("input", renderCustomers);
  $("customerListCompanyFilter").addEventListener("change", renderCustomers);
  $("exportFilteredJobsButton").addEventListener("click", exportFilteredJobs);
  $("invoiceKindTabs").addEventListener("click", event => {
    const button=event.target.closest("button[data-kind]"); if(!button)return;
    $("invoiceKind").value=button.dataset.kind;
    $("invoiceKindTabs").querySelectorAll("button").forEach(item=>item.classList.toggle("active",item===button));
    state.invoicePage=0; loadInvoiceArchive();
  });
  ["invoiceDateField","invoiceDateFrom","invoiceDateTo","invoiceCompanyId","invoiceJobType"]
    .forEach(id => $(id).addEventListener("change", () => {state.invoicePage=0; loadInvoiceArchive();}));
  $("invoiceSearch").addEventListener("input", () => {
    clearTimeout(state.invoiceSearchTimer);
    state.invoiceSearchTimer=setTimeout(()=>{state.invoicePage=0;loadInvoiceArchive();},350);
  });
  $("invoiceThisMonthButton").addEventListener("click", setInvoiceThisMonth);
  $("clearInvoiceFiltersButton").addEventListener("click", clearInvoiceFilters);
  $("downloadFilteredInvoicesButton").addEventListener("click", downloadFilteredInvoices);
  $("currency").addEventListener("change", async () => {
    if (value("currency") === "TL") $("exchangeRate").value = "1";
    else await fetchRate(value("currency"));
  });
  ["filterCompanyId","filterJobType","filterDateField","filterDateFrom","filterDateTo","filterCurrency","filterPaymentMethod","filterHotelInvoice","filterCustomerInvoice","filterPayment","filterSort"]
    .forEach(id => $(id).addEventListener("change", () => {state.currentPage=0; loadJobs();}));
  $("searchInput").addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {state.currentPage=0; loadJobs();}, 350);
  });
  $("migrateDocumentsButton").addEventListener("click", migrateLegacyDocuments);
  $("downloadBackupButton").addEventListener("click", downloadFullBackup);
  $("clearJobFiltersButton").addEventListener("click", clearJobFilters);
}

async function login(event) {
  event.preventDefault();
  const button = $("loginButton");
  setBusy(button, true, "Giriş yapılıyor...");
  $("loginError").textContent = "";
  const { error } = await db.auth.signInWithPassword({email:value("loginEmail"), password:$("loginPassword").value});
  setBusy(button, false);
  if (error) $("loginError").textContent = "E-posta veya şifre hatalı.";
}

async function navigate(page) {
  state.activePage = page;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  $(`page-${page}`).classList.add("active");
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  document.querySelector(".sidebar").classList.remove("open");
  if (page === "dashboard") await loadDashboard();
  if (page === "newJob" && !value("jobId")) resetJobForm(false);
  if (page === "jobs") {state.currentPage=0; await loadJobs();}
  if (page === "customers") renderCustomers();
  if (page === "invoices") {state.invoicePage=0; await loadInvoiceArchive();}
  if (page === "payments") await loadSpecialJobs("payments");
  if (page === "reports") await loadReports();
  if (page === "trash") await loadTrash();
  window.scrollTo({top:0, behavior:"smooth"});
}

async function loadLookups() {
  const [companies, customers, cards, customerCompanies] = await Promise.all([
    db.from("companies").select("id,name").is("deleted_at",null).order("name"),
    db.from("customers").select("id,name").is("deleted_at",null).order("name"),
    db.from("payment_cards").select("id,name").is("deleted_at",null).order("name"),
    db.from("customer_companies").select("customer_id,company_id")
  ]);
  [companies, customers, cards, customerCompanies].forEach(r => {if (r.error) throw r.error;});
  state.companies = companies.data || [];
  state.customers = customers.data || [];
  state.cards = cards.data || [];
  state.customerCompanies = customerCompanies.data || [];
  fillSelect($("companyId"), state.companies, "Firma seç");
  fillSelect($("filterCompanyId"), state.companies, "Tüm firmalar");
  fillSelect($("customerListCompanyFilter"), state.companies, "Tüm firmalar");
  fillSelect($("invoiceCompanyId"), state.companies, "Tüm firmalar");
  fillSelect($("customerIds"), state.customers, null);
  fillSelect($("paymentCardId"), state.cards, "Kart seç");
  renderCustomerPageCompanyChecks();
  renderSelectedCustomers();
}

function fillSelect(select, rows, placeholder) {
  const current = select.multiple ? selectedValues(select.id) : select.value;
  select.innerHTML = placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : "";
  rows.forEach(row => select.insertAdjacentHTML("beforeend", `<option value="${row.id}">${esc(row.name)}</option>`));
  if (select.multiple) [...select.options].forEach(o => o.selected = current.includes(o.value));
  else if (rows.some(r => r.id === current)) select.value = current;
}

function getCustomerCompanyIds(customerId) {
  return state.customerCompanies.filter(link=>link.customer_id===customerId).map(link=>link.company_id);
}

function getCustomerCompanyNames(customerId) {
  const ids = new Set(getCustomerCompanyIds(customerId));
  return state.companies.filter(company=>ids.has(company.id)).map(company=>company.name);
}

function renderCustomerPageCompanyChecks() {
  $("customerPageCompanyChecks").innerHTML = state.companies.map(company => `
    <label class="company-check"><input type="checkbox" value="${company.id}"> ${esc(company.name)}</label>`).join("");
}

function renderCustomerSearchResults() {
  const area = $("customerSearchResults");
  const query = value("customerSearch").toLocaleLowerCase("tr-TR");
  if (!query) {
    area.innerHTML = '<div class="customer-hint">Misafir bulmak için yukarıya isim yaz.</div>';
    return;
  }
  const selected = new Set(selectedValues("customerIds"));
  const selectedCompanyId = value("companyId");
  const companyOnly = $("customerCompanyOnly").checked && !!selectedCompanyId;
  const matches = state.customers
    .filter(customer => customer.name.toLocaleLowerCase("tr-TR").includes(query))
    .filter(customer => !companyOnly || getCustomerCompanyIds(customer.id).includes(selectedCompanyId))
    .sort((a,b) => {
      const aMatch=getCustomerCompanyIds(a.id).includes(selectedCompanyId)?1:0;
      const bMatch=getCustomerCompanyIds(b.id).includes(selectedCompanyId)?1:0;
      return bMatch-aMatch || a.name.localeCompare(b.name,"tr");
    })
    .slice(0, 12);
  area.innerHTML = matches.length ? matches.map(customer => `
    <button class="customer-result-button ${selected.has(customer.id)?"selected":""}" type="button" onclick="selectCustomer('${customer.id}')">
      <span><strong>${esc(customer.name)}</strong><small>${esc(getCustomerCompanyNames(customer.id).join(", ")||"Firma atanmamış")}</small></span>
      <small>${selected.has(customer.id)?"Seçildi":"Seç"}</small>
    </button>`).join("") : `<div class="customer-hint">${companyOnly?"Seçili firmada bu isimle müşteri bulunamadı. Tüm müşterileri görmek için kutunun işaretini kaldırabilirsin.":"Bu isimle kayıtlı misafir bulunamadı."}</div>`;
}

function renderSelectedCustomers() {
  const selected = new Set(selectedValues("customerIds"));
  $("selectedCustomers").innerHTML = state.customers
    .filter(customer => selected.has(customer.id))
    .map(customer => `<span class="selected-customer">${esc(customer.name)}<button type="button" aria-label="${esc(customer.name)} seçimini kaldır" onclick="removeSelectedCustomer('${customer.id}')">×</button></span>`)
    .join("");
}

function selectCustomer(id) {
  const option = [...$("customerIds").options].find(item => item.value === id);
  if (option) option.selected = true;
  $("customerSearch").value = "";
  renderSelectedCustomers();
  renderCustomerSearchResults();
  $("customerSearch").focus();
}

function removeSelectedCustomer(id) {
  const option = [...$("customerIds").options].find(item => item.value === id);
  if (option) option.selected = false;
  renderSelectedCustomers();
  renderCustomerSearchResults();
}
window.selectCustomer = selectCustomer;
window.removeSelectedCustomer = removeSelectedCustomer;

async function loadDashboard() {
  const [{data:stats,error}, jobs] = await Promise.all([
    db.rpc("dashboard_stats"),
    fetchJobs({limit:5,offset:0})
  ]);
  if (error) throw error;
  const s = stats || {};
  const profitRate = Number(s.total_sale_try) ? Number(s.total_profit_try)/Number(s.total_sale_try)*100 : 0;
  const cards = [
    ["Toplam İş", s.total_jobs || 0, ""], ["Toplam Maliyet", moneyTry(s.total_cost_try), ""],
    ["Toplam Satış", moneyTry(s.total_sale_try), ""], ["Toplam Kâr", moneyTry(s.total_profit_try), "good"],
    ["Kâr Oranı", `%${profitRate.toFixed(1)}`, "good"], ["Bekleyen Gelen Fatura (Otel)", s.pending_hotel_invoices || 0, "warn"],
    ["Kesilmeyen Giden Fatura", s.pending_customer_invoices || 0, "warn"], ["Bekleyen Ödeme", s.pending_payments || 0, "warn"]
  ];
  $("stats").innerHTML = cards.map(([label,val,cls]) => `<div class="stat ${cls}"><span>${esc(label)}</span><strong>${esc(val)}</strong></div>`).join("");
  $("recentJobs").innerHTML = jobs.items.length ? jobs.items.map(jobCard).join("") : empty("Henüz iş kaydı bulunmuyor.");
}

async function fetchJobs({search="", hotelInvoice="", customerInvoice="", payment="", companyId="", jobType="", dateField="check_in", dateFrom="", dateTo="", currency="", paymentMethod="", sort="created_desc", includeDeleted=false, onlyDeleted=false, limit=PAGE_SIZE, offset=0}={}) {
  const {data,error} = await db.rpc("search_jobs_v3", {
    p_search:search, p_hotel_invoice_status:hotelInvoice, p_customer_invoice_status:customerInvoice,
    p_payment_status:payment, p_company_id:companyId||null, p_job_type:jobType,
    p_date_field:dateField||"check_in", p_date_from:dateFrom||null, p_date_to:dateTo||null, p_currency:currency,
    p_payment_method:paymentMethod, p_sort:sort, p_include_deleted:includeDeleted,
    p_only_deleted:onlyDeleted, p_limit:limit, p_offset:offset
  });
  if (error) throw error;
  const items = (data || []).map(row => ({...row.job, company_name:row.company_name, card_name:row.card_name, customers:row.customers||[], documents:row.documents||[]}));
  return {items, total:Number(data?.[0]?.total_count || 0)};
}

async function loadJobs() {
  $("jobsList").innerHTML = empty("Kayıtlar yükleniyor...");
  try {
    const filters = getCurrentJobFilters();
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
      $("jobsList").innerHTML = empty("Başlangıç tarihi bitiş tarihinden sonra olamaz.");
      $("filterResultSummary").textContent = "Tarih aralığını düzelt";
      return;
    }
    const result = await fetchJobs({...filters, offset:state.currentPage*PAGE_SIZE});
    state.jobs = result.items; state.totalJobs = result.total;
    $("filterResultSummary").textContent = `${result.total.toLocaleString("tr-TR")} iş bulundu`;
    $("jobsList").innerHTML = result.items.length ? result.items.map(jobCard).join("") : empty("Filtreye uygun kayıt bulunamadı.");
    renderPagination();
  } catch (error) { handleError(error,"İşler yüklenemedi"); }
}

function getCurrentJobFilters() {
  return {
    search:value("searchInput"), companyId:value("filterCompanyId"), jobType:value("filterJobType"), dateField:value("filterDateField")||"check_in",
    dateFrom:value("filterDateFrom"), dateTo:value("filterDateTo"), currency:value("filterCurrency"),
    paymentMethod:value("filterPaymentMethod"), hotelInvoice:value("filterHotelInvoice"),
    customerInvoice:value("filterCustomerInvoice"), payment:value("filterPayment"), sort:value("filterSort")||"created_desc"
  };
}

function clearJobFilters() {
  ["searchInput","filterCompanyId","filterJobType","filterDateFrom","filterDateTo","filterCurrency","filterPaymentMethod","filterHotelInvoice","filterCustomerInvoice","filterPayment"]
    .forEach(id => $(id).value="");
  $("filterDateField").value="check_in";
  $("filterSort").value="created_desc";
  state.currentPage=0;
  loadJobs();
}

function jobCard(job, options={}) {
  const names = (job.customers||[]).map(c=>c.name).join(", ") || "-";
  const profit = (Number(job.sale)-Number(job.cost));
  const deleted = !!job.deleted_at;
  return `<article class="job-card">
    <div class="job-top"><div class="job-title"><h3>${esc(job.hotel_name)}</h3><p>${esc(job.company_name)} · ${esc(names)}</p></div><div class="job-sale"><span>Satış</span><strong>${money(job.sale,job.currency)}</strong></div></div>
    <div class="badges">
      ${badge(`Gelen Fatura: ${job.hotel_invoice_status}`,job.hotel_invoice_status!=="Bekliyor")}
      ${badge(`Giden Fatura: ${job.customer_invoice_status}`,job.customer_invoice_status==="Kesildi")}
      ${badge(`Ödeme: ${job.payment_status}`,job.payment_status==="Alındı")}
    </div>
    <div class="job-grid">
      <div><span>İşin Girildiği Tarih</span><b>${dateTimeTR(job.created_at)}</b></div>
      <div><span>Tarih</span><b>${dateTR(job.check_in)} – ${dateTR(job.check_out)}</b></div>
      <div><span>Oda</span><b>${esc(job.room_count)} · ${esc(job.room_type||"-")}</b></div>
      <div><span>Maliyet</span><b>${money(job.cost,job.currency)}</b></div>
      <div><span>Satış</span><b>${money(job.sale,job.currency)}</b></div>
      <div><span>Kâr</span><b>${money(profit,job.currency)}</b></div>
    </div>
    <div class="job-actions">
      ${(job.documents||[]).map((d,index)=>`<button class="secondary" title="${esc(d.original_name)}" onclick="openDocument('${d.id}')">${d.kind==="outgoing"?"Giden":"Gelen"} fatura${job.documents.length>1?` ${index+1}`:""}</button>`).join("")}
      ${deleted ? `<button class="primary" onclick="restoreJob('${job.id}',${job.version})">Geri yükle</button>` : `<button class="secondary" onclick="editJob('${job.id}')">Düzenle</button><button class="danger" onclick="deleteJob('${job.id}',${job.version})">Çöpe taşı</button>`}
    </div>
  </article>`;
}

function badge(text, done) { return `<span class="badge ${done?"done":"pending"}">${esc(text)}</span>`; }
function empty(text) { return `<div class="empty">${esc(text)}</div>`; }

function renderPagination() {
  const pages = Math.ceil(state.totalJobs/PAGE_SIZE);
  $("pagination").innerHTML = pages <= 1 ? "" : `<button class="secondary" ${state.currentPage===0?"disabled":""} onclick="changePage(-1)">← Önceki</button><span>${state.currentPage+1} / ${pages}</span><button class="secondary" ${state.currentPage>=pages-1?"disabled":""} onclick="changePage(1)">Sonraki →</button>`;
}
window.changePage = async delta => {state.currentPage+=delta; await loadJobs(); window.scrollTo({top:0,behavior:"smooth"});};

async function exportFilteredJobs() {
  const button = $("exportFilteredJobsButton");
  if (!window.XLSX) return toast("Excel bileşeni yüklenemedi. Sayfayı yenileyip tekrar dene.", "error");
  setBusy(button, true, "Excel hazırlanıyor...");
  try {
    const filters = getCurrentJobFilters();
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) return toast("Tarih aralığını düzeltmelisin.", "error");
    const first = await fetchJobs({...filters, limit:100, offset:0});
    const jobs = [...first.items];
    for (let offset=100; offset<first.total; offset+=100) {
      button.textContent = `Kayıtlar alınıyor (${Math.min(offset,first.total)}/${first.total})...`;
      const page = await fetchJobs({...filters, limit:100, offset});
      jobs.push(...page.items);
    }
    if (!jobs.length) return toast("Excel'e aktarılacak iş bulunamadı.", "error");

    const rows = jobs.map(job => {
      const rate = job.job_type === "YURT DIŞI" ? 0 : 0.12;
      const cost = Number(job.cost)||0, sale = Number(job.sale)||0, exchange = Number(job.exchange_rate)||1;
      const costNet = cost/(1+rate), saleNet = sale/(1+rate);
      const profit = sale-cost, profitNet = saleNet-costNet;
      const nights = calculateNights(job.check_in, job.check_out);
      return {
        "Firma":job.company_name||"", "Otel":job.hotel_name||"",
        "Misafirler":(job.customers||[]).map(customer=>customer.name).join(", "),
        "İşin Girildiği Tarih":job.created_at?new Date(job.created_at).toLocaleString("tr-TR"):"",
        "Oda Sayısı":Number(job.room_count)||0, "Oda Tipi":job.room_type||"",
        "Check-in":job.check_in||"", "Check-out":job.check_out||"", "Geceleme":nights,
        "Oda Gece":nights*(Number(job.room_count)||0), "Talep Eden":job.requester||"",
        "Talep Kanalı":job.request_channel||"", "İş Tipi":job.job_type||"",
        "Para Birimi":job.currency||"TL", "Kur":exchange, "KDV Oranı (%)":rate*100,
        "Maliyet KDV Hariç":round2(costNet), "Maliyet KDV":round2(cost-costNet),
        "Maliyet KDV Dahil":cost, "Satış KDV Hariç":round2(saleNet),
        "Satış KDV":round2(sale-saleNet), "Satış KDV Dahil":sale,
        "Kâr KDV Hariç":round2(profitNet), "Kâr KDV Dahil":round2(profit),
        "Kâr Yüzdesi (%)":costNet ? round2((profitNet/costNet)*100) : 0,
        "Maliyet TL":round2(cost*exchange), "Satış TL":round2(sale*exchange),
        "Kâr TL":round2(profit*exchange), "Ödeme Yöntemi":job.payment_method||"",
        "Kart":job.card_name||"", "Gelen Fatura Durumu":job.hotel_invoice_status||"",
        "Giden Fatura Durumu":job.customer_invoice_status||"", "Ödeme":job.payment_status||"",
        "Gelen Fatura Sayısı":(job.documents||[]).filter(document=>document.kind!=="outgoing").length,
        "Giden Fatura Sayısı":(job.documents||[]).filter(document=>document.kind==="outgoing").length, "Ekstralar":job.extras||"",
        "Notlar":job.notes||"", "Kayıt ID":job.id
      };
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!autofilter"] = {ref:sheet["!ref"]};
    sheet["!cols"] = Object.keys(rows[0]).map(key => ({wch:Math.min(Math.max(key.length+2, 13), key.includes("Not")||key.includes("Misafir")||key.includes("Otel")?38:22)}));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "İşler");
    const companyName = state.companies.find(company=>company.id===filters.companyId)?.name || "";
    const filterSheet = XLSX.utils.aoa_to_sheet([
      ["Uygulanan Filtre", "Değer"], ["Genel arama", filters.search||"Tümü"], ["Firma", companyName||"Tümü"],
      ["İş tipi", filters.jobType||"Tümü"], ["Tarih ölçütü", filters.dateField==="created_at"?"İşin girildiği tarih":"Check-in tarihi"],
      ["Tarih başlangıç", filters.dateFrom||"Tümü"], ["Tarih bitiş", filters.dateTo||"Tümü"], ["Para birimi", filters.currency||"Tümü"],
      ["Ödeme yöntemi", filters.paymentMethod||"Tümü"], ["Gelen fatura durumu", filters.hotelInvoice||"Tümü"],
      ["Giden fatura durumu", filters.customerInvoice||"Tümü"], ["Ödeme durumu", filters.payment||"Tümü"],
      ["Sıralama", $("filterSort").selectedOptions[0]?.textContent||"En son eklenen"],
      ["Dışa aktarma tarihi", new Date().toLocaleString("tr-TR")], ["Toplam iş", jobs.length]
    ]);
    filterSheet["!cols"]=[{wch:24},{wch:42}];
    XLSX.utils.book_append_sheet(workbook, filterSheet, "Filtreler");
    const searchLabel = filters.search || companyName || filters.jobType || "Tum_Isler";
    const safeLabel = searchLabel.normalize("NFKD").replace(/[^a-zA-Z0-9_-]/g,"_").replace(/_+/g,"_").slice(0,45);
    XLSX.writeFile(workbook, `MIA_${safeLabel}_${new Date().toISOString().slice(0,10)}.xlsx`, {compression:true});
    toast(`${jobs.length} iş Excel olarak indirildi.`);
  } catch (error) {
    handleError(error, "Excel oluşturulamadı");
  } finally {
    setBusy(button, false);
  }
}

function calculateNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const difference = (new Date(`${checkOut}T00:00:00`) - new Date(`${checkIn}T00:00:00`))/86400000;
  return Math.max(Number.isFinite(difference)?difference:0, 0);
}
function round2(number) { return Math.round((Number(number)+Number.EPSILON)*100)/100; }

async function saveJob(event) {
  event.preventDefault();
  if (value("checkIn") && value("checkOut") && value("checkOut") < value("checkIn")) return toast("Check-out tarihi check-in tarihinden önce olamaz.","error");
  if (!value("companyId") || !value("hotelName")) return toast("Firma ve otel zorunludur.","error");
  const button = $("saveJobButton"); setBusy(button,true,"Kaydediliyor...");
  try {
    const payload = {
      company_id:value("companyId"), hotel_name:value("hotelName"), room_count:Number(value("roomCount")||1),
      room_type:value("roomType"), check_in:value("checkIn"), check_out:value("checkOut"), requester:value("requester"),
      request_channel:value("requestChannel"), job_type:value("jobType"), cost:Number(value("cost")||0), sale:Number(value("sale")||0),
      currency:value("currency"), exchange_rate:Number(value("exchangeRate")||1), payment_method:value("paymentMethod"),
      payment_card_id:value("paymentCardId"), hotel_invoice_status:value("hotelInvoiceStatus"),
      customer_invoice_status:value("customerInvoiceStatus"), payment_status:value("paymentStatus"), extras:value("extras"), notes:value("notes")
    };
    const customerIds=selectedValues("customerIds");
    const {data:saved,error} = await db.rpc("save_job", {
      p_job_id:value("jobId")||null, p_expected_version:Number(value("jobVersion")||0), p_job:payload, p_customer_ids:customerIds
    });
    if (error) throw error;
    customerIds.forEach(customerId=>{
      if(!state.customerCompanies.some(link=>link.customer_id===customerId&&link.company_id===payload.company_id))
        state.customerCompanies.push({customer_id:customerId,company_id:payload.company_id});
    });
    const incomingFiles=[...$("incomingInvoiceFiles").files];
    const outgoingFiles=[...$("outgoingInvoiceFiles").files];
    for (let i=0;i<incomingFiles.length;i++) {
      button.textContent=`Gelen fatura yükleniyor (${i+1}/${incomingFiles.length})...`;
      await uploadDocument(saved.id,incomingFiles[i],"incoming");
    }
    if(incomingFiles.length){
      const {error:statusError}=await db.from("jobs").update({hotel_invoice_status:"Geldi"}).eq("id",saved.id);
      if(statusError)throw statusError;
    }
    for (let i=0;i<outgoingFiles.length;i++) {
      button.textContent=`Giden fatura yükleniyor (${i+1}/${outgoingFiles.length})...`;
      await uploadDocument(saved.id,outgoingFiles[i],"outgoing");
    }
    if(outgoingFiles.length){
      const {error:statusError}=await db.from("jobs").update({customer_invoice_status:"Kesildi"}).eq("id",saved.id);
      if(statusError)throw statusError;
    }
    toast("İş güvenle kaydedildi.");
    resetJobForm();
    await Promise.all([loadDashboard(),checkLegacyDocuments()]);
    navigate("jobs");
  } catch (error) {
    if (String(error.message).includes("KAYIT_BASKA_YERDE_GUNCELLENDI")) toast("Bu kayıt başka bir ekranda değiştirilmiş. Sayfayı yenileyip tekrar dene.","error");
    else handleError(error,"İş kaydedilemedi");
  } finally {setBusy(button,false);}
}

async function uploadDocument(jobId,file,kind) {
  if (file.size > 20*1024*1024) throw new Error(`${file.name}: Dosya 20 MB sınırını aşıyor.`);
  if(!["application/pdf","image/jpeg","image/png","image/webp"].includes(file.type))throw new Error(`${file.name}: Yalnızca PDF, JPG, PNG veya WEBP yüklenebilir.`);
  if(!["incoming","outgoing"].includes(kind))throw new Error("Fatura türü geçersiz.");
  const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-140);
  const path = `${jobId}/${kind}/${crypto.randomUUID()}-${safeName}`;
  const {error:uploadError} = await db.storage.from("invoices").upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
  if (uploadError) throw uploadError;
  const {error:metaError} = await db.from("job_documents").insert({job_id:jobId,kind,original_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,uploaded_by:state.user.id});
  if (metaError) {await db.storage.from("invoices").remove([path]); throw metaError;}
}

window.editJob = async id => {
  try {
    const {data,error}=await db.from("jobs").select("*").eq("id",id).single(); if(error) throw error;
    const [{data:company},{data:links},{data:docs}] = await Promise.all([
      db.from("companies").select("name").eq("id",data.company_id).single(), db.from("job_customers").select("customer_id").eq("job_id",id),
      db.from("job_documents").select("id,kind,original_name,storage_path,mime_type,size_bytes,legacy_data_url,created_at").eq("job_id",id).is("deleted_at",null)
    ]);
    const job={...data,company_name:company?.name,customers:(links||[]).map(l=>state.customers.find(c=>c.id===l.customer_id)).filter(Boolean),documents:(docs||[]).map(d=>({...d,is_legacy:!!d.legacy_data_url}))};
    fillJobForm(job); navigate("newJob");
  } catch(error){handleError(error,"Kayıt açılamadı");}
};

function fillJobForm(job) {
  $("jobFormTitle").textContent="İşi Düzenle"; $("saveJobButton").textContent="Değişiklikleri kaydet"; $("cancelEditButton").classList.remove("hidden");
  const map={jobId:job.id,jobVersion:job.version,companyId:job.company_id,hotelName:job.hotel_name,roomCount:job.room_count,roomType:job.room_type||"",checkIn:job.check_in||"",checkOut:job.check_out||"",requester:job.requester||"",requestChannel:job.request_channel,jobType:job.job_type,cost:job.cost,sale:job.sale,currency:job.currency,exchangeRate:job.exchange_rate,paymentMethod:job.payment_method,paymentCardId:job.payment_card_id||"",hotelInvoiceStatus:job.hotel_invoice_status,customerInvoiceStatus:job.customer_invoice_status,paymentStatus:job.payment_status,extras:job.extras||"",notes:job.notes||""};
  Object.entries(map).forEach(([id,val])=>$(id).value=val);
  $("jobCreatedAt").value=dateTimeTR(job.created_at);$("jobCreatedAtField").classList.remove("hidden");
  const customerIds=(job.customers||[]).map(c=>c.id); [...$("customerIds").options].forEach(o=>o.selected=customerIds.includes(o.value));
  $("customerSearch").value=""; renderSelectedCustomers(); renderCustomerSearchResults();
  renderExistingDocuments(job.documents||[],"incoming","existingIncomingDocuments");
  renderExistingDocuments(job.documents||[],"outgoing","existingOutgoingDocuments");
  toggleCardField();
}

function renderExistingDocuments(documents,kind,targetId){
  const rows=documents.filter(document=>(document.kind==="outgoing"?"outgoing":"incoming")===kind);
  $(targetId).innerHTML=rows.map(document=>`<div class="document-item"><span><span class="document-kind ${kind}">${kind==="incoming"?"GELEN":"GİDEN"}</span> ${esc(document.original_name)}</span><button type="button" class="secondary" onclick="openDocument('${document.id}')">Aç</button></div>`).join("");
}

function resetJobForm(go=true) {
  $("jobForm").reset(); $("jobId").value=""; $("jobVersion").value=""; $("roomCount").value="1"; $("exchangeRate").value="1"; $("cost").value="0"; $("sale").value="0";
  $("jobCreatedAt").value="";$("jobCreatedAtField").classList.add("hidden");
  [...$("customerIds").options].forEach(o=>o.selected=false); $("customerSearch").value=""; renderSelectedCustomers(); renderCustomerSearchResults();
  $("jobFormTitle").textContent="Yeni İş"; $("saveJobButton").textContent="İşi kaydet"; $("cancelEditButton").classList.add("hidden"); $("existingIncomingDocuments").innerHTML=""; $("existingOutgoingDocuments").innerHTML=""; toggleCardField();
  if(go) navigate("jobs");
}

window.deleteJob = async (id,version) => {
  if(!confirm("Bu iş çöp kutusuna taşınsın mı? Kayıt daha sonra geri alınabilir.")) return;
  const {data,error}=await db.from("jobs").update({deleted_at:new Date().toISOString()}).eq("id",id).eq("version",version).select("id");
  if(error || !data?.length) return toast("Kayıt başka bir yerde değişmiş olabilir. Sayfayı yenile.","error");
  toast("İş çöp kutusuna taşındı."); await loadJobs();
};
window.restoreJob = async (id,version) => {
  const {data,error}=await db.from("jobs").update({deleted_at:null}).eq("id",id).eq("version",version).select("id");
  if(error || !data?.length) return toast("Kayıt geri yüklenemedi.","error");
  toast("İş geri yüklendi."); await loadTrash();
};

window.openDocument = async id => {
  const tab=window.open("about:blank","_blank");
  try {
    const {data,error}=await db.from("job_documents").select("storage_path,legacy_data_url,original_name").eq("id",id).single(); if(error) throw error;
    if(data.storage_path){const {data:signed,error:signError}=await db.storage.from("invoices").createSignedUrl(data.storage_path,300);if(signError)throw signError;tab.location=signed.signedUrl;}
    else if(data.legacy_data_url) {const url=URL.createObjectURL(dataUrlToBlob(data.legacy_data_url));tab.location=url;setTimeout(()=>URL.revokeObjectURL(url),300000);}
    else throw new Error("Dosya bulunamadı");
  }catch(error){tab?.close();handleError(error,"Fatura açılamadı");}
};

async function addCompanyFromForm() {
  const name=value("newCompanyName"); if(!name)return toast("Firma adını yaz.","error");
  const {data,error}=await db.from("companies").insert({name}).select("id,name").single();
  if(error)return handleError(error,"Firma eklenemedi");
  state.companies.push(data); state.companies.sort((a,b)=>a.name.localeCompare(b.name,"tr"));
  fillSelect($("companyId"),state.companies,"Firma seç"); fillSelect($("filterCompanyId"),state.companies,"Tüm firmalar");
  fillSelect($("customerListCompanyFilter"),state.companies,"Tüm firmalar"); fillSelect($("invoiceCompanyId"),state.companies,"Tüm firmalar"); renderCustomerPageCompanyChecks();
  $("companyId").value=data.id; $("newCompanyName").value=""; toast("Firma eklendi.");
}
async function addCustomer(name, companyIds=[]) {
  const {data,error}=await db.from("customers").insert({name}).select("id,name").single();
  if(error)throw error;
  if(companyIds.length){
    const links=companyIds.map(companyId=>({customer_id:data.id,company_id:companyId,created_by:state.user.id}));
    const {error:linkError}=await db.from("customer_companies").insert(links);
    if(linkError){await db.from("customers").delete().eq("id",data.id);throw linkError;}
    state.customerCompanies.push(...links.map(({customer_id,company_id})=>({customer_id,company_id})));
  }
  state.customers.push(data); state.customers.sort((a,b)=>a.name.localeCompare(b.name,"tr"));
  fillSelect($("customerIds"),state.customers,null); return data;
}
async function addCustomerFromForm(){
  const name=value("newCustomerName"), companyId=value("companyId");
  if(!name)return toast("Müşteri adını yaz.","error");
  if(!companyId)return toast("Yeni müşteriyi bağlamak için önce işin firmasını seç.","error");
  try{const data=await addCustomer(name,[companyId]);selectCustomer(data.id);$("newCustomerName").value="";toast("Müşteri firmaya bağlandı ve seçildi.");}catch(e){handleError(e,"Müşteri eklenemedi");}
}
async function addCustomerFromPage(){
  const name=value("customerPageName");
  const companyIds=[...document.querySelectorAll("#customerPageCompanyChecks input:checked")].map(input=>input.value);
  if(!name)return toast("Müşteri adını yaz.","error");
  if(!companyIds.length)return toast("En az bir firma seç.","error");
  try{await addCustomer(name,companyIds);$("customerPageName").value="";document.querySelectorAll("#customerPageCompanyChecks input").forEach(input=>input.checked=false);renderCustomers();toast("Müşteri seçili firmalara eklendi.");}catch(e){handleError(e,"Müşteri eklenemedi");}
}
async function addCardFromForm(){const name=value("newCardName");if(!name)return toast("Kart adını veya son 4 haneyi yaz.","error");const {data,error}=await db.from("payment_cards").insert({name}).select("id,name").single();if(error)return handleError(error,"Kart eklenemedi");state.cards.push(data);state.cards.sort((a,b)=>a.name.localeCompare(b.name,"tr"));fillSelect($("paymentCardId"),state.cards,"Kart seç");$("paymentCardId").value=data.id;$("newCardName").value="";toast("Kart eklendi.");}

function renderCustomers(){
  const query=value("customerListSearch").toLocaleLowerCase("tr-TR"), companyFilter=value("customerListCompanyFilter");
  const filtered=state.customers.filter(customer=>customer.name.toLocaleLowerCase("tr-TR").includes(query))
    .filter(customer=>!companyFilter||getCustomerCompanyIds(customer.id).includes(companyFilter));
  $("customerListSummary").textContent=`${filtered.length.toLocaleString("tr-TR")} müşteri`;
  const groups=[];
  const companies=companyFilter?state.companies.filter(company=>company.id===companyFilter):state.companies;
  companies.forEach(company=>{
    const customers=filtered.filter(customer=>getCustomerCompanyIds(customer.id).includes(company.id));
    if(customers.length)groups.push(renderCustomerGroup(company.name,customers));
  });
  if(!companyFilter){
    const unassigned=filtered.filter(customer=>getCustomerCompanyIds(customer.id).length===0);
    if(unassigned.length)groups.push(renderCustomerGroup("Firma atanmamış",unassigned));
  }
  $("customersList").innerHTML=groups.join("")||empty("Filtreye uygun müşteri bulunamadı.");
}

function renderCustomerGroup(companyName,customers){
  return `<section class="customer-group"><div class="customer-group-header"><h3>${esc(companyName)}</h3><span>${customers.length} müşteri</span></div>${customers.map(renderCustomerRecord).join("")}</section>`;
}

function renderCustomerRecord(customer){
  const linkedIds=new Set(getCustomerCompanyIds(customer.id));
  const linked=state.companies.filter(company=>linkedIds.has(company.id));
  const available=state.companies.filter(company=>!linkedIds.has(company.id));
  return `<div class="customer-record"><div class="customer-record-main"><div><h4>${esc(customer.name)}</h4><div class="company-tags">${linked.length?linked.map(company=>`<span class="company-tag">${esc(company.name)}<button type="button" title="Firma bağlantısını kaldır" onclick="removeCustomerCompany('${customer.id}','${company.id}')">×</button></span>`).join(""):'<span class="muted">Firma atanmamış</span>'}</div></div>${available.length?`<div class="customer-company-editor"><select>${available.map(company=>`<option value="${company.id}">${esc(company.name)}</option>`).join("")}</select><button class="secondary" type="button" onclick="addCustomerCompany('${customer.id}', this.previousElementSibling.value)">Firma ekle</button></div>`:'<span class="muted">Tüm firmalara bağlı</span>'}</div></div>`;
}

async function addCustomerCompany(customerId,companyId){
  if(!companyId)return;
  const {error}=await db.from("customer_companies").insert({customer_id:customerId,company_id:companyId,created_by:state.user.id});
  if(error)return handleError(error,"Firma bağlantısı eklenemedi");
  state.customerCompanies.push({customer_id:customerId,company_id:companyId}); renderCustomers(); renderCustomerSearchResults(); toast("Müşteri firmaya bağlandı.");
}

async function removeCustomerCompany(customerId,companyId){
  if(!confirm("Bu müşterinin firma bağlantısı kaldırılsın mı? Geçmiş işler etkilenmez."))return;
  const {error}=await db.from("customer_companies").delete().eq("customer_id",customerId).eq("company_id",companyId);
  if(error)return handleError(error,"Firma bağlantısı kaldırılamadı");
  state.customerCompanies=state.customerCompanies.filter(link=>!(link.customer_id===customerId&&link.company_id===companyId)); renderCustomers(); renderCustomerSearchResults(); toast("Firma bağlantısı kaldırıldı.");
}
window.addCustomerCompany=addCustomerCompany;
window.removeCustomerCompany=removeCustomerCompany;

function toggleCardField(){const show=["Kredi Kartı","Sanal Kart"].includes(value("paymentMethod"));$("cardField").classList.toggle("hidden",!show);if(!show)$("paymentCardId").value="";}
async function fetchRate(currency){try{const response=await fetch(`https://open.er-api.com/v6/latest/${currency}`);const data=await response.json();if(data?.rates?.TRY)$("exchangeRate").value=Number(data.rates.TRY).toFixed(6);else throw new Error();}catch{toast("Kur alınamadı; elle yazabilirsin.","error");}}

function getInvoiceFilters(){
  return {
    search:value("invoiceSearch"), kind:value("invoiceKind"), companyId:value("invoiceCompanyId"),
    jobType:value("invoiceJobType"), dateFrom:value("invoiceDateFrom"), dateTo:value("invoiceDateTo"),
    dateField:value("invoiceDateField")||"check_in"
  };
}

async function fetchInvoiceDocuments(filters={}){
  const {data,error}=await db.rpc("search_invoice_documents_v1",{
    p_search:filters.search||"", p_kind:filters.kind||"", p_company_id:filters.companyId||null,
    p_job_type:filters.jobType||"", p_date_from:filters.dateFrom||null, p_date_to:filters.dateTo||null,
    p_date_field:filters.dateField||"check_in", p_limit:filters.limit||PAGE_SIZE,
    p_offset:filters.offset??state.invoicePage*PAGE_SIZE
  });
  if(error)throw error;
  return {items:data||[],total:Number(data?.[0]?.total_count||0)};
}

async function loadInvoiceArchive(){
  const target=$("invoiceArchiveList"),filters=getInvoiceFilters();
  if(filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo){
    target.innerHTML=empty("Başlangıç tarihi bitiş tarihinden sonra olamaz."); return;
  }
  target.innerHTML=empty("Faturalar yükleniyor...");
  try{
    const [current,incoming,outgoing]=await Promise.all([
      fetchInvoiceDocuments(filters),
      fetchInvoiceDocuments({...filters,kind:"incoming",limit:1,offset:0}),
      fetchInvoiceDocuments({...filters,kind:"outgoing",limit:1,offset:0})
    ]);
    state.invoiceTotal=current.total;
    $("invoiceIncomingCount").textContent=incoming.total.toLocaleString("tr-TR");
    $("invoiceOutgoingCount").textContent=outgoing.total.toLocaleString("tr-TR");
    $("invoiceTotalCount").textContent=current.total.toLocaleString("tr-TR");
    $("invoiceResultSummary").textContent=`${current.total.toLocaleString("tr-TR")} fatura bulundu`;
    target.innerHTML=current.items.length?current.items.map(invoiceDocumentRow).join(""):empty("Bu filtrelere uygun yüklenmiş fatura bulunamadı.");
    renderInvoicePagination();
  }catch(error){
    target.innerHTML=empty("Faturalar yüklenemedi.");
    handleError(error,"Fatura arşivi yüklenemedi");
  }
}

function invoiceDocumentRow(document){
  const outgoing=document.kind==="outgoing",kind=outgoing?"outgoing":"incoming";
  const kindLabel=outgoing?"GİDEN":"GELEN";
  const uploaded=document.uploaded_at?new Intl.DateTimeFormat("tr-TR",{dateStyle:"short",timeStyle:"short"}).format(new Date(document.uploaded_at)):"-";
  return `<article class="invoice-document-row">
    <div class="invoice-type-mark ${kind}">${kindLabel}<br>FATURA</div>
    <div class="invoice-document-main">
      <h3 title="${esc(document.original_name)}">${esc(document.original_name)}</h3>
      <p>${esc(document.company_name)} · ${esc(document.hotel_name)}</p>
      <div class="invoice-document-meta">
        <span>Check-in: <b>${dateTR(document.check_in)}</b></span>
        <span>${esc(document.job_type)}</span>
        <span>Yüklenme: ${esc(uploaded)}</span>
        <span>${formatBytes(document.size_bytes)}</span>
        ${document.customer_names?`<span>Misafir: ${esc(document.customer_names)}</span>`:""}
      </div>
    </div>
    <div class="invoice-document-actions">
      <button class="secondary" type="button" onclick="openDocument('${document.document_id}')">Aç</button>
      <button class="primary" type="button" onclick="downloadInvoiceDocument('${document.document_id}')">İndir</button>
    </div>
  </article>`;
}

function formatBytes(bytes){
  const number=Number(bytes)||0;if(!number)return "Boyut bilinmiyor";
  if(number<1024)return `${number} B`;if(number<1048576)return `${(number/1024).toFixed(1)} KB`;
  return `${(number/1048576).toFixed(1)} MB`;
}

function renderInvoicePagination(){
  const pages=Math.ceil(state.invoiceTotal/PAGE_SIZE);
  $("invoicePagination").innerHTML=pages<=1?"":`<button class="secondary" ${state.invoicePage===0?"disabled":""} onclick="changeInvoicePage(-1)">← Önceki</button><span>${state.invoicePage+1} / ${pages}</span><button class="secondary" ${state.invoicePage>=pages-1?"disabled":""} onclick="changeInvoicePage(1)">Sonraki →</button>`;
}
window.changeInvoicePage=async delta=>{state.invoicePage+=delta;await loadInvoiceArchive();window.scrollTo({top:0,behavior:"smooth"});};

function setInvoiceThisMonth(){
  const today=new Date(),year=today.getFullYear(),month=today.getMonth()+1,lastDay=new Date(year,month,0).getDate();
  $("invoiceDateFrom").value=`${year}-${String(month).padStart(2,"0")}-01`;
  $("invoiceDateTo").value=`${year}-${String(month).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;
  state.invoicePage=0;loadInvoiceArchive();
}

function clearInvoiceFilters(){
  $("invoiceSearch").value="";$("invoiceKind").value="";$("invoiceDateField").value="check_in";
  $("invoiceDateFrom").value="";$("invoiceDateTo").value="";$("invoiceCompanyId").value="";$("invoiceJobType").value="";
  $("invoiceKindTabs").querySelectorAll("button").forEach(button=>button.classList.toggle("active",button.dataset.kind===""));
  $("invoiceDownloadProgress").textContent="";state.invoicePage=0;loadInvoiceArchive();
}

async function getDocumentBlob(document){
  if(document.storage_path){
    const {data,error}=await db.storage.from("invoices").download(document.storage_path);if(error)throw error;return data;
  }
  const {data,error}=await db.from("job_documents").select("legacy_data_url").eq("id",document.document_id||document.id).single();
  if(error)throw error;if(!data?.legacy_data_url)throw new Error("Fatura dosyası bulunamadı");return dataUrlToBlob(data.legacy_data_url);
}

window.downloadInvoiceDocument=async id=>{
  try{
    const {data,error}=await db.from("job_documents").select("id,original_name,storage_path,legacy_data_url").eq("id",id).single();if(error)throw error;
    const blob=await getDocumentBlob({...data,document_id:data.id});downloadBlob(blob,data.original_name);
  }catch(error){handleError(error,"Fatura indirilemedi");}
};

function safeFilePart(text,max=70){return String(text||"").normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g,"_").replace(/_+/g,"_").replace(/^_+|_+$/g,"").slice(0,max)||"Kayit";}

async function downloadFilteredInvoices(){
  if(!window.JSZip||!window.XLSX)return toast("ZIP/Excel bileşeni yüklenemedi. Sayfayı yenileyip tekrar dene.","error");
  const button=$("downloadFilteredInvoicesButton"),progress=$("invoiceDownloadProgress"),filters=getInvoiceFilters();
  if(filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo)return toast("Tarih aralığını düzeltmelisin.","error");
  setBusy(button,true,"Faturalar hazırlanıyor...");
  try{
    const first=await fetchInvoiceDocuments({...filters,limit:100,offset:0}),documents=[...first.items];
    for(let offset=100;offset<first.total;offset+=100){
      progress.textContent=`Fatura kayıtları alınıyor: ${Math.min(offset,first.total)}/${first.total}`;
      const page=await fetchInvoiceDocuments({...filters,limit:100,offset});documents.push(...page.items);
    }
    if(!documents.length)return toast("İndirilecek fatura bulunamadı.","error");
    const zip=new JSZip(),failures=[],manifest=[];
    for(let i=0;i<documents.length;i++){
      const document=documents[i],outgoing=document.kind==="outgoing";
      progress.textContent=`Faturalar ekleniyor: ${i+1}/${documents.length} · ${document.original_name}`;
      let status="İndirildi";
      try{
        const blob=await getDocumentBlob(document);
        const folder=outgoing?"Giden_Faturalar":"Gelen_Faturalar";
        const name=[document.check_in||"Tarihsiz",safeFilePart(document.company_name,35),safeFilePart(document.hotel_name,45),document.document_id.slice(0,8),safeFilePart(document.original_name,100)].join("_");
        zip.file(`${folder}/${name}`,blob);
      }catch(error){status="İndirilemedi";failures.push(`${document.original_name}: ${error?.message||"Bilinmeyen hata"}`);}
      manifest.push({
        "Fatura Türü":outgoing?"Giden Fatura":"Gelen Fatura","Firma":document.company_name||"","Otel":document.hotel_name||"",
        "Misafirler":document.customer_names||"","İş Tipi":document.job_type||"","Check-in":document.check_in||"","Check-out":document.check_out||"",
        "Fatura Yüklenme Tarihi":document.uploaded_at?new Date(document.uploaded_at).toLocaleString("tr-TR"):"","Dosya Adı":document.original_name||"",
        "Dosya Boyutu":formatBytes(document.size_bytes),"İndirme Durumu":status,"İş ID":document.job_id,"Belge ID":document.document_id
      });
    }
    const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(manifest);
    sheet["!autofilter"]={ref:sheet["!ref"]};sheet["!cols"]=[22,28,35,35,15,14,14,22,40,16,18,38,38].map(wch=>({wch}));
    XLSX.utils.book_append_sheet(workbook,sheet,"Fatura Listesi");
    const companyName=state.companies.find(company=>company.id===filters.companyId)?.name||"Tüm firmalar";
    const filterSheet=XLSX.utils.aoa_to_sheet([
      ["Uygulanan Filtre","Değer"],["Fatura türü",filters.kind==="incoming"?"Gelen":filters.kind==="outgoing"?"Giden":"Tümü"],
      ["Tarih ölçütü",filters.dateField==="uploaded_at"?"Yüklenme tarihi":"İş check-in tarihi"],["Başlangıç",filters.dateFrom||"Tümü"],
      ["Bitiş",filters.dateTo||"Tümü"],["İş tipi",filters.jobType||"Tümü"],["Firma",companyName],["Arama",filters.search||"Yok"],
      ["Oluşturulma",new Date().toLocaleString("tr-TR")],["Toplam fatura",documents.length],["Başarısız dosya",failures.length]
    ]);filterSheet["!cols"]=[{wch:24},{wch:42}];XLSX.utils.book_append_sheet(workbook,filterSheet,"Filtreler");
    zip.file("Fatura_Listesi.xlsx",XLSX.write(workbook,{bookType:"xlsx",type:"array"}));
    if(failures.length)zip.file("Indirilemeyen_Faturalar.txt",failures.join("\n"));
    progress.textContent="ZIP dosyası oluşturuluyor...";
    const result=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}},metadata=>{progress.textContent=`ZIP oluşturuluyor: %${Math.round(metadata.percent)}`;});
    const typeName=filters.kind==="incoming"?"Gelen":filters.kind==="outgoing"?"Giden":"Tum";
    const jobTypeName=filters.jobType==="YURT İÇİ"?"Yurtici":filters.jobType==="YURT DIŞI"?"Yurtdisi":"Tum_Isler";
    const dateName=filters.dateFrom||filters.dateTo?`${filters.dateFrom||"Baslangic"}_${filters.dateTo||"Bugun"}`:"Tum_Tarihler";
    downloadBlob(result,`MIA_Faturalar_${typeName}_${jobTypeName}_${dateName}.zip`);
    progress.textContent=`${documents.length-failures.length}/${documents.length} fatura ZIP dosyasına eklendi.`;
    toast(failures.length?`ZIP hazır; ${failures.length} dosya indirilemedi.`:`${documents.length} fatura ZIP olarak indirildi.`,failures.length?"error":"success");
  }catch(error){handleError(error,"Faturalar indirilemedi");}
  finally{setBusy(button,false);}
}

async function loadSpecialJobs(kind){
  const target=$("paymentJobs");target.innerHTML=empty("Yükleniyor...");
  try{
    const jobs=(await fetchJobs({payment:"Bekliyor",limit:100})).items.concat((await fetchJobs({payment:"Kısmi",limit:100})).items);
    target.innerHTML=jobs.length?jobs.map(jobCard).join(""):empty("Bekleyen ödeme yok.");
  }catch(e){handleError(e,"Kayıtlar yüklenemedi");}
}

async function loadReports(){const {data,error}=await db.rpc("company_report");if(error)return handleError(error,"Rapor yüklenemedi");state.reportCompanies=Object.fromEntries((data||[]).map(r=>[r.company_id,r.company_name]));$("companyReports").innerHTML=(data||[]).map(r=>`<div class="report-card"><h3>${esc(r.company_name)}</h3><div class="report-numbers"><div><span>İş</span><b>${r.job_count}</b></div><div><span>Satış</span><b>${moneyTry(r.sale_try)}</b></div><div><span>Kâr</span><b>${moneyTry(r.profit_try)}</b></div></div><button class="secondary" onclick="downloadCompanyCsv('${r.company_id}')">CSV indir</button></div>`).join("")||empty("Raporlanacak veri yok.");}
window.downloadCompanyCsv=async id=>{try{const name=state.reportCompanies[id]||"Firma";const rows=await getAllRows("jobs","*",q=>q.eq("company_id",id).is("deleted_at",null));const headers=["Otel","Check-in","Check-out","Oda","Maliyet","Satış","Para","Ödeme","Gelen Fatura Durumu","Giden Fatura Durumu","Notlar"];const lines=[headers,...rows.map(j=>[j.hotel_name,j.check_in,j.check_out,j.room_count,j.cost,j.sale,j.currency,j.payment_status,j.hotel_invoice_status,j.customer_invoice_status,j.notes||""])];downloadBlob(new Blob(["\uFEFF"+lines.map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\n")],{type:"text/csv;charset=utf-8"}),`${name.replace(/[^a-z0-9]/gi,"_")}_hizmet_dokumu.csv`);}catch(e){handleError(e,"CSV oluşturulamadı");}};

async function loadTrash(){try{const r=await fetchJobs({onlyDeleted:true,limit:100});$("trashJobs").innerHTML=r.items.length?r.items.map(jobCard).join(""):empty("Çöp kutusu boş.");}catch(e){handleError(e,"Çöp kutusu yüklenemedi");}}

async function checkLegacyDocuments(){const {count,error}=await db.from("job_documents").select("id",{count:"exact",head:true}).not("legacy_data_url","is",null);if(error)return;$("migrationBanner").classList.toggle("hidden",!count);$("migrationText").textContent=count?`${count} eski fatura sırayla taşınacak; işlem sırasında sayfayı kapatma.`:"";}
async function migrateLegacyDocuments(){const button=$("migrateDocumentsButton");setBusy(button,true,"Hazırlanıyor...");try{const {data,error}=await db.from("job_documents").select("id,job_id,original_name,legacy_data_url").not("legacy_data_url","is",null);if(error)throw error;for(let i=0;i<data.length;i++){button.textContent=`Taşınıyor ${i+1}/${data.length}`;const d=data[i];const blob=dataUrlToBlob(d.legacy_data_url);const file=new File([blob],d.original_name,{type:blob.type});const safe=file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-140);const path=`${d.job_id}/${crypto.randomUUID()}-${safe}`;const {error:up}=await db.storage.from("invoices").upload(path,file,{contentType:blob.type,upsert:false});if(up)throw up;const {error:upd}=await db.from("job_documents").update({storage_path:path,mime_type:blob.type,size_bytes:blob.size,legacy_data_url:null,uploaded_by:state.user.id}).eq("id",d.id);if(upd){await db.storage.from("invoices").remove([path]);throw upd;}}toast("Bütün eski faturalar güvenli dosya alanına taşındı.");await checkLegacyDocuments();}catch(e){handleError(e,"Fatura taşıma yarıda kaldı; tekrar deneyebilirsin");}finally{setBusy(button,false);}}
function dataUrlToBlob(dataUrl){const [head,body]=dataUrl.split(",");const mime=head.match(/data:(.*?);/)?.[1]||"application/octet-stream";const bytes=atob(body);const arr=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)arr[i]=bytes.charCodeAt(i);return new Blob([arr],{type:mime});}

async function getAllRows(table,columns="*",modify=q=>q){let out=[];for(let from=0;;from+=1000){let query=db.from(table).select(columns).range(from,from+999);query=modify(query);const {data,error}=await query;if(error)throw error;out.push(...data);if(data.length<1000)break;}return out;}
async function downloadFullBackup(){if(!window.JSZip)return toast("Yedekleme bileşeni yüklenemedi.","error");const button=$("downloadBackupButton");setBusy(button,true,"Yedek hazırlanıyor...");try{const progress=$("backupProgress");progress.textContent="Veritabanı kayıtları alınıyor...";const tables=["companies","customers","customer_companies","payment_cards","jobs","job_customers","job_documents","audit_logs","app_settings"];const backup={version:4,created_at:new Date().toISOString(),tables:{}};for(const table of tables){backup.tables[table]=await getAllRows(table,table==="job_documents"?"id,job_id,kind,original_name,storage_path,mime_type,size_bytes,uploaded_by,created_at,deleted_at":"*");}const zip=new JSZip();zip.file("veritabani-yedegi.json",JSON.stringify(backup,null,2));const docs=backup.tables.job_documents.filter(d=>!d.deleted_at);for(let i=0;i<docs.length;i++){const d=docs[i];progress.textContent=`Faturalar ekleniyor: ${i+1}/${docs.length}`;let blob;if(d.storage_path){const {data,error}=await db.storage.from("invoices").download(d.storage_path);if(error)throw error;blob=data;}else{const {data,error}=await db.from("job_documents").select("legacy_data_url").eq("id",d.id).single();if(error)throw error;blob=dataUrlToBlob(data.legacy_data_url);}const folder=d.kind==="outgoing"?"Giden_Faturalar":"Gelen_Faturalar";zip.file(`faturalar/${folder}/${d.job_id}/${d.original_name}`,blob);}progress.textContent="ZIP dosyası oluşturuluyor...";const result=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}});downloadBlob(result,`MIA_Otel_Sistem_Yedek_${new Date().toISOString().slice(0,10)}.zip`);progress.textContent="Yedek başarıyla indirildi.";toast("Tam sistem yedeği hazırlandı.");}catch(e){handleError(e,"Yedek oluşturulamadı");}finally{setBusy(button,false);}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}

function handleError(error, fallback) { console.error(error); toast(`${fallback}: ${error?.message || "Bilinmeyen hata"}`, "error"); }

init();
