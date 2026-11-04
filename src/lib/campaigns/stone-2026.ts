// «حملة المشاريع» — a one-off outreach to the companies behind the 20 project
// opportunity files (31 Oct 2026). Temporary: delete this folder, the page and
// the API when the campaign is done.
//
// Every address below comes from those files. One email per COMPANY (its
// selected addresses together on the To: line), never a blast with everyone in
// To/CC. Addresses that are not a procurement desk (media, customer care, a
// payments team) start unticked, with the reason shown — the owner decides.

export interface CampaignEmail {
  email: string
  label: string
  /** Ticked by default. */
  recommended: boolean
  /** Why it is unticked / what to check — shown next to it. */
  note?: string
}

export interface CampaignTarget {
  id: string
  company_ar: string
  company_en: string
  /** The project file numbers (1–20) this company appears in. */
  files: number[]
  project_ar: string
  project_en: string
  emails: CampaignEmail[]
}

export const CAMPAIGN_ID = 'stone-projects-2026'

export const TARGETS: CampaignTarget[] = [
  {
    id: 'hassan-allam', company_ar: 'حسن علام', company_en: 'Hassan Allam', files: [1, 13],
    project_ar: 'مجمّع هيوماين لمراكز البيانات ومركز خزام للأعمال', project_en: 'the HUMAIN AI Data Centre Campus and Khuzam Business Center',
    emails: [{ email: 'info@hassanallam.com', label: 'البريد العام', recommended: true }],
  },
  {
    id: 'humain', company_ar: 'هيوماين', company_en: 'HUMAIN', files: [1],
    project_ar: 'مجمّع هيوماين لمراكز بيانات الذكاء الاصطناعي', project_en: 'the HUMAIN 6GW AI Data Centre Campus',
    emails: [{ email: 'pr@humain.ai', label: 'بريد الإعلام', recommended: false, note: 'بريد الإعلام والصحافة — ليس للمشتريات' }],
  },
  {
    id: 'adel-real-estate', company_ar: 'عدل العقارية', company_en: 'Adel Real Estate', files: [2],
    project_ar: 'الدمام الجديد', project_en: 'New Dammam',
    emails: [
      { email: 'info@adelrealestate.com', label: 'البريد العام', recommended: true },
      { email: 'marketing@adelrealestate.com', label: 'التسويق', recommended: false, note: 'التسويق — يكفي البريد العام' },
    ],
  },
  {
    id: 'tmg', company_ar: 'مجموعة طلعت مصطفى', company_en: 'Talaat Moustafa Group', files: [4],
    project_ar: 'مشروع روشن × طلعت مصطفى – الأرض رقم 1 بالرياض', project_en: 'the ROSHN × TMG Plot 1 development in Riyadh',
    emails: [{ email: 'TMGJeddah@tmg.com.eg', label: 'فرع جدة', recommended: true }],
  },
  {
    id: 'algihaz', company_ar: 'الجهاز للمقاولات', company_en: 'Al Gihaz Contracting', files: [5],
    project_ar: 'مطار الملك عبدالعزيز الدولي', project_en: 'King Abdulaziz International Airport',
    emails: [{ email: 'info@algihaz.com', label: 'البريد العام', recommended: true }],
  },
  {
    id: 'eagle-hills', company_ar: 'إيجل هيلز', company_en: 'Eagle Hills', files: [6],
    project_ar: 'مشروع سلوان في عسير', project_en: 'the Silwan development in Asir',
    emails: [{ email: 'info@eaglehills.com', label: 'البريد العام', recommended: true }],
  },
  {
    id: 'gillespies', company_ar: 'جيليسبيز', company_en: 'Gillespies', files: [6],
    project_ar: 'مشروع سلوان في عسير', project_en: 'the Silwan development in Asir',
    emails: [{ email: 'mail@gillespies.co.uk', label: 'البريد العام', recommended: true }],
  },
  {
    id: 'mod', company_ar: 'وزارة الدفاع', company_en: 'Ministry of Defense', files: [7],
    project_ar: 'المدينة العسكرية الجديدة (P-563)', project_en: 'the New Military City programme (P-563)',
    emails: [{ email: 'srelationship@mod.gov.sa', label: 'علاقات الموردين', recommended: true }],
  },
  {
    id: 'typsa', company_ar: 'تيبسا', company_en: 'TYPSA', files: [7, 15],
    project_ar: 'المدينة العسكرية الجديدة والجسر البري السعودي', project_en: 'the New Military City programme and the Saudi Landbridge',
    emails: [{ email: 'arabia@typsa.com', label: 'مكتب الرياض', recommended: true }],
  },
  {
    id: 'al-ayuni', company_ar: 'العيوني للاستثمار والمقاولات', company_en: 'Al-Ayuni Investment & Contracting', files: [8],
    project_ar: 'مشروع البحر الأحمر', project_en: 'The Red Sea project',
    emails: [{ email: 'info@alayuni.com', label: 'البريد العام', recommended: true, note: 'دومين البريد يختلف عن موقعهم (al-ayuni.com) — لو رجع الإيميل فهو غير صحيح' }],
  },
  {
    id: 'binladin', company_ar: 'مجموعة بن لادن السعودية', company_en: 'Saudi Binladin Group', files: [8],
    project_ar: 'مشروع البحر الأحمر', project_en: 'The Red Sea project',
    emails: [{ email: 'info@sbg.com.sa', label: 'البريد العام', recommended: true }],
  },
  {
    id: 'rua-alharam', company_ar: 'رؤى الحرم المكي', company_en: 'Rua Al Haram Al Makki', files: [9],
    project_ar: 'بوابة الملك سلمان بمكة المكرمة', project_en: 'King Salman Gate in Makkah',
    emails: [{ email: 'info@ruaalharam.com', label: 'البريد العام', recommended: true }],
  },
  {
    id: 'nhc', company_ar: 'الشركة الوطنية للإسكان', company_en: 'National Housing Company (NHC)', files: [13],
    project_ar: 'ضاحية خزام ومركز خزام للأعمال', project_en: 'Khuzam Suburb and the Khuzam Business Center',
    emails: [
      { email: 'Vmp@nhc.sa', label: 'إدارة الموردين', recommended: true },
      { email: 'care@nhc.sa', label: 'خدمة العملاء', recommended: false, note: 'خدمة العملاء — إدارة الموردين تكفي' },
    ],
  },
  {
    id: 'azad', company_ar: 'أزاد العقارية', company_en: 'Azad Properties', files: [13],
    project_ar: 'مشروعكم التجاري في خزام', project_en: 'your commercial development in Khuzam',
    emails: [{ email: 'info@azad.com.sa', label: 'البريد العام', recommended: true }],
  },
  {
    id: 'sar', company_ar: 'الشركة السعودية للخطوط الحديدية (سار)', company_en: 'Saudi Arabia Railways (SAR)', files: [15],
    project_ar: 'الجسر البري السعودي', project_en: 'the Saudi Landbridge',
    emails: [{ email: 'chatcustomercare@sar.com.sa', label: 'خدمة العملاء', recommended: false, note: 'خدمة عملاء الركاب — الأفضل بوابة موردي سار' }],
  },
  {
    id: 'ae-prime', company_ar: 'إيه إي برايم', company_en: 'AE Prime', files: [16],
    project_ar: 'مدينة مطار جدة', project_en: 'Jeddah Airport City',
    emails: [{ email: 'aeprime@primeec.com', label: 'مدير المشروع', recommended: true }],
  },
  {
    id: 'tga', company_ar: 'الهيئة العامة للنقل', company_en: 'Transport General Authority', files: [17, 19],
    project_ar: 'جسر الملك حمد وجسر الملك سلمان', project_en: 'the King Hamad Causeway and the King Salman Bridge',
    emails: [{ email: '19929@tga.gov.sa', label: 'الخدمة الموحدة', recommended: false, note: 'رقم الخدمة الموحد (شكاوى واستفسارات) — ليس للموردين' }],
  },
  {
    id: 'neom', company_ar: 'نيوم', company_en: 'NEOM', files: [18],
    project_ar: 'أوكساجون وميناء نيوم', project_en: 'Oxagon and the Port of NEOM',
    emails: [{ email: 'P2P.ResolutionTeam@neom.com', label: 'دعم الموردين', recommended: false, note: 'فريق مدفوعات الموردين المسجّلين — التسجيل الجديد عبر بوابة نيوم' }],
  },
  {
    id: 'el-seif', company_ar: 'السيف للهندسة', company_en: 'El Seif Engineering', files: [18],
    project_ar: 'مباني ميناء نيوم في أوكساجون', project_en: 'the Port of NEOM buildings in Oxagon',
    emails: [{ email: 'BusinessDev@el-seif.com.sa', label: 'تطوير الأعمال', recommended: true }],
  },
  {
    id: 'arada', company_ar: 'أراد السعودية', company_en: 'Arada KSA', files: [20],
    project_ar: 'مشروعكم السكني في حي الرمال', project_en: 'your Al Rimal residential community in Riyadh',
    emails: [{ email: 'support@arada.com', label: 'البريد العام', recommended: true, note: 'سجّلوا أيضاً في نموذج الموردين على arada.sa' }],
  },
]

export const DEFAULT_SUBJECT = 'Natural Stone Supply for {{project}} | KAASEB – an Abraj Al-Asima Company'

export const DEFAULT_BODY = `السادة {{company_ar}} المحترمين،
تحية طيبة وبعد،

يسرّنا في «كاسب» — الذراع المتخصصة في الرخام والجرانيت التابعة لشركة أبراج العاصمة — أن نعرّفكم بخدماتنا في توريد وتركيب الحجر الطبيعي للمشاريع الكبرى في المملكة: الرخام، الجرانيت، الحجر الجيري، والكوارتز.

نتابع باهتمام {{project_ar}}، ونرى أن نطاق الحجر الطبيعي فيه يتوافق مع إمكاناتنا:
• جودة معتمدة بشهادة ISO 9001:2015
• منظومة متكاملة: اختيار المحاجر، القص، المعالجة، الفحص والتغليف
• 35 معدة و10 مركبات لالتزام الجداول الزمنية
• مواد متوافقة مع متطلبات LEED ومستدام
• خبرة في مشاريع كبرى منها البحر الأحمر الدولية، حديقة الملك سلمان، أمالا، وشيراتون

مرفق لكم ملف التعريف (البروفايل) الخاص بشركة أبراج العاصمة، الشركة الأم لكاسب.

نتطلع إلى إدراجنا ضمن قائمة الموردين المعتمدين لديكم، أو تقديم عرض سعر لأي حزمة حجر طبيعي حالية أو قادمة، ويسعدنا تزويدكم بالعينات والمستندات الفنية ووثائق التأهيل المسبق عند الطلب.

وتقبلوا خالص التحية،

────────────

Dear {{company}} Procurement Team,

KAASEB is the marble and granite arm of Abraj Al-Asima Company. We supply and install natural marble, granite, limestone and quartz for major projects across the Kingdom.

We have been following {{project}} with great interest, and we believe our capabilities are a strong fit for its natural-stone scope:
• ISO 9001:2015 certified quality management
• Fully integrated process: quarry selection, cutting, surface processing, quality control and packing
• 35 machines and 10 vehicles to keep large packages on schedule
• Materials supporting LEED and Mostadam certified projects
• Proven on landmark projects including Red Sea Global, King Salman Park, Amaala and The Sheraton

Attached is the company profile of Abraj Al-Asima, KAASEB's parent company.

We would welcome being added to your approved supplier list, or the opportunity to quote on any current or upcoming natural-stone package. Samples, technical submittals and pre-qualification documents are available on request.

Best regards,

KAASEB — an Abraj Al-Asima Company
Marble & Granite
Kharj Road, Al-Manakh District, Riyadh, Saudi Arabia
+966 50 626 8080 | info@kaaseb.sa | kaaseb.sa`

export function varsFor(t: CampaignTarget): Record<string, string> {
  return { company: t.company_en, company_ar: t.company_ar, project: t.project_en, project_ar: t.project_ar }
}

/** Fill {{vars}}. Unknown names are left visible on purpose — the preview
 *  shows them, and the send route refuses a message that still has one. */
export function fill(text: string, vars: Record<string, string>): string {
  return (text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (vars[k] ?? '').trim() || m)
}

export const hasUnfilled = (text: string) => /\{\{\s*\w+\s*\}\}/.test(text)
