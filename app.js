const SUPABASE_URL = "https://mpwspnccuaqyitwghqip.supabase.co";
const SUPABASE_KEY = "sb_publishable_lWeTQWJVlynCDmQWcdDSVQ_E0AfIJJX";
const PAGE_SIZE = 50;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  user: null,
  companies: [],
  customers: [],
  cards: [],
  jobs: [],
  currentPage: 0,
  totalJobs: 0,
  reportCompanies: {},
  activePage: "dashboard",
  searchTimer: null
};

const $ = id => document.getElementById(id);
const value = id => $(id).value.trim();
const selectedValues = id => [...$(id).options].filter(option => option.selected).map(option => option.value);
const esc = input => String(input ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const money = (amount, currency = "TL") => new Intl.NumberFormat("tr-TR", {style:"currency", currency: currency === "TL" ? "TRY" : currency, maximumFractionDigits:2}).format(Number(amount)||0);
const moneyTry = amount => money(amount, "TL");
const dateTR = d => d ? new Intl.DateTimeFormat("tr-TR").format(new Date(`${d}T00:00:00`)) : "-";
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
  $("exportFilteredJobsButton").addEventListener("click", exportFilteredJobs);
  $("currency").addEventListener("change", async () => {
    if (value("currency") === "TL") $("exchangeRate").value = "1";
    else await fetchRate(value("currency"));
  });
  ["filterHotelInvoice","filterCustomerInvoice","filterPayment"].forEach(id => $(id).addEventListener("change", () => {state.currentPage=0; loadJobs();}));
  $("searchInput").addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {state.currentPage=0; loadJobs();}, 350);
  });
  $("migrateDocumentsButton").addEventListener("click", migrateLegacyDocuments);
  $("downloadBackupButton").addEventListener("click", downloadFullBackup);
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
  if (page === "invoices") await loadSpecialJobs("invoices");
  if (page === "payments") await loadSpecialJobs("payments");
  if (page === "reports") await loadReports();
  if (page === "trash") await loadTrash();
  window.scrollTo({top:0, behavior:"smooth"});
}

async function loadLookups() {
  const [companies, customers, cards] = await Promise.all([
    db.from("companies").select("id,name").is("deleted_at",null).order("name"),
    db.from("customers").select("id,name").is("deleted_at",null).order("name"),
    db.from("payment_cards").select("id,name").is("deleted_at",null).order("name")
  ]);
  [companies, customers, cards].forEach(r => {if (r.error) throw r.error;});
  state.companies = companies.data || [];
  state.customers = customers.data || [];
  state.cards = cards.data || [];
  fillSelect($("companyId"), state.companies, "Firma seç");
  fillSelect($("customerIds"), state.customers, null);
  fillSelect($("paymentCardId"), state.cards, "Kart seç");
  renderSelectedCustomers();
}

function fillSelect(select, rows, placeholder) {
  const current = select.multiple ? selectedValues(select.id) : select.value;
  select.innerHTML = placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : "";
  rows.forEach(row => select.insertAdjacentHTML("beforeend", `<option value="${row.id}">${esc(row.name)}</option>`));
  if (select.multiple) [...select.options].forEach(o => o.selected = current.includes(o.value));
  else if (rows.some(r => r.id === current)) select.value = current;
}

function renderCustomerSearchResults() {
  const area = $("customerSearchResults");
  const query = value("customerSearch").toLocaleLowerCase("tr-TR");
  if (!query) {
    area.innerHTML = '<div class="customer-hint">Misafir bulmak için yukarıya isim yaz.</div>';
    return;
  }
  const selected = new Set(selectedValues("customerIds"));
  const matches = state.customers
    .filter(customer => customer.name.toLocaleLowerCase("tr-TR").includes(query))
    .slice(0, 12);
  area.innerHTML = matches.length ? matches.map(customer => `
    <button class="customer-result-button ${selected.has(customer.id)?"selected":""}" type="button" onclick="selectCustomer('${customer.id}')">
      <span>${esc(customer.name)}</span><small>${selected.has(customer.id)?"Seçildi":"Seç"}</small>
    </button>`).join("") : '<div class="customer-hint">Bu isimle kayıtlı misafir bulunamadı.</div>';
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
    ["Kâr Oranı", `%${profitRate.toFixed(1)}`, "good"], ["Bekleyen Otel Faturası", s.pending_hotel_invoices || 0, "warn"],
    ["Kesilmeyen Müşteri Faturası", s.pending_customer_invoices || 0, "warn"], ["Bekleyen Ödeme", s.pending_payments || 0, "warn"]
  ];
  $("stats").innerHTML = cards.map(([label,val,cls]) => `<div class="stat ${cls}"><span>${esc(label)}</span><strong>${esc(val)}</strong></div>`).join("");
  $("recentJobs").innerHTML = jobs.items.length ? jobs.items.map(jobCard).join("") : empty("Henüz iş kaydı bulunmuyor.");
}

async function fetchJobs({search="", hotelInvoice="", customerInvoice="", payment="", includeDeleted=false, onlyDeleted=false, limit=PAGE_SIZE, offset=0}={}) {
  const {data,error} = await db.rpc("search_jobs", {
    p_search:search, p_hotel_invoice_status:hotelInvoice, p_customer_invoice_status:customerInvoice,
    p_payment_status:payment, p_include_deleted:includeDeleted, p_only_deleted:onlyDeleted, p_limit:limit, p_offset:offset
  });
  if (error) throw error;
  const items = (data || []).map(row => ({...row.job, company_name:row.company_name, card_name:row.card_name, customers:row.customers||[], documents:row.documents||[]}));
  return {items, total:Number(data?.[0]?.total_count || 0)};
}

async function loadJobs() {
  $("jobsList").innerHTML = empty("Kayıtlar yükleniyor...");
  try {
    const result = await fetchJobs({
      search:value("searchInput"), hotelInvoice:value("filterHotelInvoice"),
      customerInvoice:value("filterCustomerInvoice"), payment:value("filterPayment"),
      offset:state.currentPage*PAGE_SIZE
    });
    state.jobs = result.items; state.totalJobs = result.total;
    $("jobsList").innerHTML = result.items.length ? result.items.map(jobCard).join("") : empty("Filtreye uygun kayıt bulunamadı.");
    renderPagination();
  } catch (error) { handleError(error,"İşler yüklenemedi"); }
}

function jobCard(job, options={}) {
  const names = (job.customers||[]).map(c=>c.name).join(", ") || "-";
  const profit = (Number(job.sale)-Number(job.cost));
  const deleted = !!job.deleted_at;
  return `<article class="job-card">
    <div class="job-top"><div class="job-title"><h3>${esc(job.hotel_name)}</h3><p>${esc(job.company_name)} · ${esc(names)}</p></div><div class="job-sale"><span>Satış</span><strong>${money(job.sale,job.currency)}</strong></div></div>
    <div class="badges">
      ${badge(`Otel Fatura: ${job.hotel_invoice_status}`,job.hotel_invoice_status!=="Bekliyor")}
      ${badge(`Müşteri Fatura: ${job.customer_invoice_status}`,job.customer_invoice_status==="Kesildi")}
      ${badge(`Ödeme: ${job.payment_status}`,job.payment_status==="Alındı")}
    </div>
    <div class="job-grid">
      <div><span>Tarih</span><b>${dateTR(job.check_in)} – ${dateTR(job.check_out)}</b></div>
      <div><span>Oda</span><b>${esc(job.room_count)} · ${esc(job.room_type||"-")}</b></div>
      <div><span>Maliyet</span><b>${money(job.cost,job.currency)}</b></div>
      <div><span>Satış</span><b>${money(job.sale,job.currency)}</b></div>
      <div><span>Kâr</span><b>${money(profit,job.currency)}</b></div>
    </div>
    <div class="job-actions">
      ${(job.documents||[]).map((d,i)=>`<button class="secondary" onclick="openDocument('${d.id}')">Fatura${job.documents.length>1?` ${i+1}`:""}</button>`).join("")}
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
    const filters = {
      search:value("searchInput"), hotelInvoice:value("filterHotelInvoice"),
      customerInvoice:value("filterCustomerInvoice"), payment:value("filterPayment")
    };
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
        "Kart":job.card_name||"", "Otel Faturası":job.hotel_invoice_status||"",
        "Müşteri Faturası":job.customer_invoice_status||"", "Ödeme":job.payment_status||"",
        "Fatura Sayısı":(job.documents||[]).length, "Ekstralar":job.extras||"",
        "Notlar":job.notes||"", "Kayıt ID":job.id
      };
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!autofilter"] = {ref:sheet["!ref"]};
    sheet["!cols"] = Object.keys(rows[0]).map(key => ({wch:Math.min(Math.max(key.length+2, 13), key.includes("Not")||key.includes("Misafir")||key.includes("Otel")?38:22)}));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "İşler");
    const searchLabel = filters.search || "Tum_Isler";
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
    const {data:saved,error} = await db.rpc("save_job", {
      p_job_id:value("jobId")||null, p_expected_version:Number(value("jobVersion")||0), p_job:payload, p_customer_ids:selectedValues("customerIds")
    });
    if (error) throw error;
    const files = [...$("invoiceFiles").files];
    for (let i=0;i<files.length;i++) {
      button.textContent = `Fatura yükleniyor (${i+1}/${files.length})...`;
      await uploadDocument(saved.id, files[i]);
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

async function uploadDocument(jobId,file) {
  if (file.size > 20*1024*1024) throw new Error(`${file.name}: Dosya 20 MB sınırını aşıyor.`);
  const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-140);
  const path = `${jobId}/${crypto.randomUUID()}-${safeName}`;
  const {error:uploadError} = await db.storage.from("invoices").upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
  if (uploadError) throw uploadError;
  const {error:metaError} = await db.from("job_documents").insert({job_id:jobId,original_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,uploaded_by:state.user.id});
  if (metaError) {await db.storage.from("invoices").remove([path]); throw metaError;}
}

window.editJob = async id => {
  try {
    const {data,error}=await db.from("jobs").select("*").eq("id",id).single(); if(error) throw error;
    const [{data:company},{data:links},{data:docs}] = await Promise.all([
      db.from("companies").select("name").eq("id",data.company_id).single(), db.from("job_customers").select("customer_id").eq("job_id",id),
      db.from("job_documents").select("id,original_name,storage_path,mime_type,size_bytes,legacy_data_url").eq("job_id",id).is("deleted_at",null)
    ]);
    const job={...data,company_name:company?.name,customers:(links||[]).map(l=>state.customers.find(c=>c.id===l.customer_id)).filter(Boolean),documents:(docs||[]).map(d=>({...d,is_legacy:!!d.legacy_data_url}))};
    fillJobForm(job); navigate("newJob");
  } catch(error){handleError(error,"Kayıt açılamadı");}
};

function fillJobForm(job) {
  $("jobFormTitle").textContent="İşi Düzenle"; $("saveJobButton").textContent="Değişiklikleri kaydet"; $("cancelEditButton").classList.remove("hidden");
  const map={jobId:job.id,jobVersion:job.version,companyId:job.company_id,hotelName:job.hotel_name,roomCount:job.room_count,roomType:job.room_type||"",checkIn:job.check_in||"",checkOut:job.check_out||"",requester:job.requester||"",requestChannel:job.request_channel,jobType:job.job_type,cost:job.cost,sale:job.sale,currency:job.currency,exchangeRate:job.exchange_rate,paymentMethod:job.payment_method,paymentCardId:job.payment_card_id||"",hotelInvoiceStatus:job.hotel_invoice_status,customerInvoiceStatus:job.customer_invoice_status,paymentStatus:job.payment_status,extras:job.extras||"",notes:job.notes||""};
  Object.entries(map).forEach(([id,val])=>$(id).value=val);
  const customerIds=(job.customers||[]).map(c=>c.id); [...$("customerIds").options].forEach(o=>o.selected=customerIds.includes(o.value));
  $("customerSearch").value=""; renderSelectedCustomers(); renderCustomerSearchResults();
  $("existingDocuments").innerHTML=(job.documents||[]).map(d=>`<div class="document-item"><span>${esc(d.original_name)}</span><button type="button" class="secondary" onclick="openDocument('${d.id}')">Aç</button></div>`).join("");
  toggleCardField();
}

function resetJobForm(go=true) {
  $("jobForm").reset(); $("jobId").value=""; $("jobVersion").value=""; $("roomCount").value="1"; $("exchangeRate").value="1"; $("cost").value="0"; $("sale").value="0";
  [...$("customerIds").options].forEach(o=>o.selected=false); $("customerSearch").value=""; renderSelectedCustomers(); renderCustomerSearchResults();
  $("jobFormTitle").textContent="Yeni İş"; $("saveJobButton").textContent="İşi kaydet"; $("cancelEditButton").classList.add("hidden"); $("existingDocuments").innerHTML=""; toggleCardField();
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
  if(error)return handleError(error,"Firma eklenemedi"); state.companies.push(data);state.companies.sort((a,b)=>a.name.localeCompare(b.name,"tr"));fillSelect($("companyId"),state.companies,"Firma seç");$("companyId").value=data.id;$("newCompanyName").value="";toast("Firma eklendi.");
}
async function addCustomer(name) {
  const {data,error}=await db.from("customers").insert({name}).select("id,name").single();if(error)throw error;state.customers.push(data);state.customers.sort((a,b)=>a.name.localeCompare(b.name,"tr"));fillSelect($("customerIds"),state.customers,null);return data;
}
async function addCustomerFromForm(){const name=value("newCustomerName");if(!name)return toast("Müşteri adını yaz.","error");try{const data=await addCustomer(name);selectCustomer(data.id);$("newCustomerName").value="";toast("Müşteri eklendi ve seçildi.");}catch(e){handleError(e,"Müşteri eklenemedi");}}
async function addCustomerFromPage(){const name=value("customerPageName");if(!name)return toast("Müşteri adını yaz.","error");try{await addCustomer(name);$("customerPageName").value="";renderCustomers();toast("Müşteri eklendi.");}catch(e){handleError(e,"Müşteri eklenemedi");}}
async function addCardFromForm(){const name=value("newCardName");if(!name)return toast("Kart adını veya son 4 haneyi yaz.","error");const {data,error}=await db.from("payment_cards").insert({name}).select("id,name").single();if(error)return handleError(error,"Kart eklenemedi");state.cards.push(data);state.cards.sort((a,b)=>a.name.localeCompare(b.name,"tr"));fillSelect($("paymentCardId"),state.cards,"Kart seç");$("paymentCardId").value=data.id;$("newCardName").value="";toast("Kart eklendi.");}
function renderCustomers(){$("customersList").innerHTML=state.customers.length?state.customers.map(c=>`<div class="list-row"><b>${esc(c.name)}</b><span class="muted">Aktif</span></div>`).join(""):empty("Müşteri yok.");}

function toggleCardField(){const show=["Kredi Kartı","Sanal Kart"].includes(value("paymentMethod"));$("cardField").classList.toggle("hidden",!show);if(!show)$("paymentCardId").value="";}
async function fetchRate(currency){try{const response=await fetch(`https://open.er-api.com/v6/latest/${currency}`);const data=await response.json();if(data?.rates?.TRY)$("exchangeRate").value=Number(data.rates.TRY).toFixed(6);else throw new Error();}catch{toast("Kur alınamadı; elle yazabilirsin.","error");}}

async function loadSpecialJobs(kind){
  const target=kind==="invoices"?$("invoiceJobs"):$("paymentJobs");target.innerHTML=empty("Yükleniyor...");
  try{let jobs=[];
    if(kind==="payments") jobs=(await fetchJobs({payment:"Bekliyor",limit:100})).items.concat((await fetchJobs({payment:"Kısmi",limit:100})).items);
    else {const a=(await fetchJobs({hotelInvoice:"Bekliyor",limit:100})).items;const b=(await fetchJobs({customerInvoice:"Kesilmedi",limit:100})).items;jobs=[...new Map([...a,...b].map(j=>[j.id,j])).values()];}
    target.innerHTML=jobs.length?jobs.map(jobCard).join(""):empty(kind==="invoices"?"Bekleyen fatura yok.":"Bekleyen ödeme yok.");
  }catch(e){handleError(e,"Kayıtlar yüklenemedi");}
}

async function loadReports(){const {data,error}=await db.rpc("company_report");if(error)return handleError(error,"Rapor yüklenemedi");state.reportCompanies=Object.fromEntries((data||[]).map(r=>[r.company_id,r.company_name]));$("companyReports").innerHTML=(data||[]).map(r=>`<div class="report-card"><h3>${esc(r.company_name)}</h3><div class="report-numbers"><div><span>İş</span><b>${r.job_count}</b></div><div><span>Satış</span><b>${moneyTry(r.sale_try)}</b></div><div><span>Kâr</span><b>${moneyTry(r.profit_try)}</b></div></div><button class="secondary" onclick="downloadCompanyCsv('${r.company_id}')">CSV indir</button></div>`).join("")||empty("Raporlanacak veri yok.");}
window.downloadCompanyCsv=async id=>{try{const name=state.reportCompanies[id]||"Firma";const rows=await getAllRows("jobs","*",q=>q.eq("company_id",id).is("deleted_at",null));const headers=["Otel","Check-in","Check-out","Oda","Maliyet","Satış","Para","Ödeme","Otel Faturası","Müşteri Faturası","Notlar"];const lines=[headers,...rows.map(j=>[j.hotel_name,j.check_in,j.check_out,j.room_count,j.cost,j.sale,j.currency,j.payment_status,j.hotel_invoice_status,j.customer_invoice_status,j.notes||""])];downloadBlob(new Blob(["\uFEFF"+lines.map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\n")],{type:"text/csv;charset=utf-8"}),`${name.replace(/[^a-z0-9]/gi,"_")}_hizmet_dokumu.csv`);}catch(e){handleError(e,"CSV oluşturulamadı");}};

async function loadTrash(){try{const r=await fetchJobs({onlyDeleted:true,limit:100});$("trashJobs").innerHTML=r.items.length?r.items.map(jobCard).join(""):empty("Çöp kutusu boş.");}catch(e){handleError(e,"Çöp kutusu yüklenemedi");}}

async function checkLegacyDocuments(){const {count,error}=await db.from("job_documents").select("id",{count:"exact",head:true}).not("legacy_data_url","is",null);if(error)return;$("migrationBanner").classList.toggle("hidden",!count);$("migrationText").textContent=count?`${count} eski fatura sırayla taşınacak; işlem sırasında sayfayı kapatma.`:"";}
async function migrateLegacyDocuments(){const button=$("migrateDocumentsButton");setBusy(button,true,"Hazırlanıyor...");try{const {data,error}=await db.from("job_documents").select("id,job_id,original_name,legacy_data_url").not("legacy_data_url","is",null);if(error)throw error;for(let i=0;i<data.length;i++){button.textContent=`Taşınıyor ${i+1}/${data.length}`;const d=data[i];const blob=dataUrlToBlob(d.legacy_data_url);const file=new File([blob],d.original_name,{type:blob.type});const safe=file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-140);const path=`${d.job_id}/${crypto.randomUUID()}-${safe}`;const {error:up}=await db.storage.from("invoices").upload(path,file,{contentType:blob.type,upsert:false});if(up)throw up;const {error:upd}=await db.from("job_documents").update({storage_path:path,mime_type:blob.type,size_bytes:blob.size,legacy_data_url:null,uploaded_by:state.user.id}).eq("id",d.id);if(upd){await db.storage.from("invoices").remove([path]);throw upd;}}toast("Bütün eski faturalar güvenli dosya alanına taşındı.");await checkLegacyDocuments();}catch(e){handleError(e,"Fatura taşıma yarıda kaldı; tekrar deneyebilirsin");}finally{setBusy(button,false);}}
function dataUrlToBlob(dataUrl){const [head,body]=dataUrl.split(",");const mime=head.match(/data:(.*?);/)?.[1]||"application/octet-stream";const bytes=atob(body);const arr=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)arr[i]=bytes.charCodeAt(i);return new Blob([arr],{type:mime});}

async function getAllRows(table,columns="*",modify=q=>q){let out=[];for(let from=0;;from+=1000){let query=db.from(table).select(columns).range(from,from+999);query=modify(query);const {data,error}=await query;if(error)throw error;out.push(...data);if(data.length<1000)break;}return out;}
async function downloadFullBackup(){if(!window.JSZip)return toast("Yedekleme bileşeni yüklenemedi.","error");const button=$("downloadBackupButton");setBusy(button,true,"Yedek hazırlanıyor...");try{const progress=$("backupProgress");progress.textContent="Veritabanı kayıtları alınıyor...";const tables=["companies","customers","payment_cards","jobs","job_customers","job_documents","audit_logs","app_settings"];const backup={version:2,created_at:new Date().toISOString(),tables:{}};for(const table of tables){backup.tables[table]=await getAllRows(table,table==="job_documents"?"id,job_id,kind,original_name,storage_path,mime_type,size_bytes,uploaded_by,created_at,deleted_at":"*");}const zip=new JSZip();zip.file("veritabani-yedegi.json",JSON.stringify(backup,null,2));const docs=backup.tables.job_documents.filter(d=>!d.deleted_at);for(let i=0;i<docs.length;i++){const d=docs[i];progress.textContent=`Faturalar ekleniyor: ${i+1}/${docs.length}`;let blob;if(d.storage_path){const {data,error}=await db.storage.from("invoices").download(d.storage_path);if(error)throw error;blob=data;}else{const {data,error}=await db.from("job_documents").select("legacy_data_url").eq("id",d.id).single();if(error)throw error;blob=dataUrlToBlob(data.legacy_data_url);}zip.file(`faturalar/${d.job_id}/${d.original_name}`,blob);}progress.textContent="ZIP dosyası oluşturuluyor...";const result=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}});downloadBlob(result,`MIA_Otel_Sistem_Yedek_${new Date().toISOString().slice(0,10)}.zip`);progress.textContent="Yedek başarıyla indirildi.";toast("Tam sistem yedeği hazırlandı.");}catch(e){handleError(e,"Yedek oluşturulamadı");}finally{setBusy(button,false);}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}

function handleError(error, fallback) { console.error(error); toast(`${fallback}: ${error?.message || "Bilinmeyen hata"}`, "error"); }

init();
