import svgPaths from "./svg-xcz9mzqp6b";

function IosSignal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="ios-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="ios-signal">
          <path clipRule="evenodd" d={svgPaths.p2bb6eb80} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosWifiSignal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="ios-wifi-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="ios-wifi-signal">
          <path clipRule="evenodd" d={svgPaths.p646c5c0} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosBatteryFull() {
  return (
    <div className="h-[20px] relative shrink-0 w-[28px]" data-name="ios-battery-full">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 28 20" width="28">
        <g id="ios-battery-full">
          <path d={svgPaths.p66c9640} fill="black" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function StatusIcons() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0" data-name="status-icons">
      <IosSignal />
      <IosWifiSignal />
      <IosBatteryFull />
    </div>
  );
}

function StatusBar() {
  return (
    <div className="content-stretch flex h-[44px] items-center justify-between px-[24px] relative shrink-0 w-full" data-name="status-bar">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">9:41</p>
      <StatusIcons />
    </div>
  );
}

function IconArrowLeft() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="icon-arrow-left">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="icon-arrow-left">
          <path d={svgPaths.pe197860} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <IconArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Dashboard</p>
    </div>
  );
}

function Frame() {
  return <div className="h-px relative shrink-0 w-[60px]" data-name="Frame" />;
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Companies</p>
      <Frame />
    </div>
  );
}

function ScreenHeader() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="screen-header">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <HeaderRow />
    </div>
  );
}

function IconSearch() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="icon-search">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="icon-search">
          <path d={svgPaths.p3f6e0f00} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function SearchBar() {
  return (
    <div className="content-stretch flex gap-[8px] h-[44px] items-center px-[16px] relative rounded-[22px] shrink-0 w-full" data-name="search-bar">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[22px]" />
      <IconSearch />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Geist:Regular',sans-serif] font-normal leading-[normal] min-w-px relative text-[#888] text-[14px]">Search company...</p>
    </div>
  );
}

function BtnAddCompany() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-add-company">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">+ Add Company</p>
    </div>
  );
}

function SearchAndAction() {
  return (
    <div className="content-stretch flex flex-col gap-[16px] items-start p-[16px] relative shrink-0 w-full" data-name="search-and-action">
      <SearchBar />
      <BtnAddCompany />
    </div>
  );
}

function CompanyLogoCircle() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-center justify-center relative rounded-[20px] shrink-0 size-[40px]" data-name="company-logo-circle">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">F</p>
    </div>
  );
}

function Frame1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[2px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">FMC Corporation</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">6 products</p>
    </div>
  );
}

function CompanyInfoLeft() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="company-info-left">
      <CompanyLogoCircle />
      <Frame1 />
    </div>
  );
}

function ChevronRight() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="chevron-right">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="chevron-right">
          <path d="M6 12L10 8L6 4" id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function CompanyInfoRight() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="company-info-right">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">Rs. 1,20,000 payable</p>
      <ChevronRight />
    </div>
  );
}

function CompanyCard() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="company-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <CompanyInfoLeft />
      <CompanyInfoRight />
    </div>
  );
}

function CompanyLogoCircle1() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-center justify-center relative rounded-[20px] shrink-0 size-[40px]" data-name="company-logo-circle">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">S</p>
    </div>
  );
}

function Frame2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[2px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Syngenta</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">12 products</p>
    </div>
  );
}

function CompanyInfoLeft1() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="company-info-left">
      <CompanyLogoCircle1 />
      <Frame2 />
    </div>
  );
}

function ChevronRight1() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="chevron-right">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="chevron-right">
          <path d="M6 12L10 8L6 4" id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function CompanyInfoRight1() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="company-info-right">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">Rs. 45,000 payable</p>
      <ChevronRight1 />
    </div>
  );
}

function CompanyCard1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="company-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <CompanyInfoLeft1 />
      <CompanyInfoRight1 />
    </div>
  );
}

function CompanyLogoCircle2() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-center justify-center relative rounded-[20px] shrink-0 size-[40px]" data-name="company-logo-circle">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">F</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[2px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Four Brothers</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">8 products</p>
    </div>
  );
}

function CompanyInfoLeft2() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="company-info-left">
      <CompanyLogoCircle2 />
      <Frame3 />
    </div>
  );
}

function ChevronRight2() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="chevron-right">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="chevron-right">
          <path d="M6 12L10 8L6 4" id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function CompanyInfoRight2() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="company-info-right">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">No dues</p>
      <ChevronRight2 />
    </div>
  );
}

function CompanyCard2() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="company-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <CompanyInfoLeft2 />
      <CompanyInfoRight2 />
    </div>
  );
}

function CompanyLogoCircle3() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-center justify-center relative rounded-[20px] shrink-0 size-[40px]" data-name="company-logo-circle">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">S</p>
    </div>
  );
}

function Frame4() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[2px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Sakata Seeds</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">4 products</p>
    </div>
  );
}

function CompanyInfoLeft3() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="company-info-left">
      <CompanyLogoCircle3 />
      <Frame4 />
    </div>
  );
}

function ChevronRight3() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="chevron-right">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="chevron-right">
          <path d="M6 12L10 8L6 4" id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function CompanyInfoRight3() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="company-info-right">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">Rs. 15,000 payable</p>
      <ChevronRight3 />
    </div>
  );
}

function CompanyCard3() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="company-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <CompanyInfoLeft3 />
      <CompanyInfoRight3 />
    </div>
  );
}

function CompanyLogoCircle4() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-center justify-center relative rounded-[20px] shrink-0 size-[40px]" data-name="company-logo-circle">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">E</p>
    </div>
  );
}

function Frame5() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[2px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Engro Corp</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">15 products</p>
    </div>
  );
}

function CompanyInfoLeft4() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="company-info-left">
      <CompanyLogoCircle4 />
      <Frame5 />
    </div>
  );
}

function ChevronRight4() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="chevron-right">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="chevron-right">
          <path d="M6 12L10 8L6 4" id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function CompanyInfoRight4() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="company-info-right">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">Rs. 85,000 payable</p>
      <ChevronRight4 />
    </div>
  );
}

function CompanyCard4() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="company-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <CompanyInfoLeft4 />
      <CompanyInfoRight4 />
    </div>
  );
}

function CompanyLogoCircle5() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-center justify-center relative rounded-[20px] shrink-0 size-[40px]" data-name="company-logo-circle">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">B</p>
    </div>
  );
}

function Frame6() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[2px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Bayer Crop</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">9 products</p>
    </div>
  );
}

function CompanyInfoLeft5() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="company-info-left">
      <CompanyLogoCircle5 />
      <Frame6 />
    </div>
  );
}

function ChevronRight5() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="chevron-right">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="chevron-right">
          <path d="M6 12L10 8L6 4" id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function CompanyInfoRight5() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="company-info-right">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">No dues</p>
      <ChevronRight5 />
    </div>
  );
}

function CompanyCard5() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="company-card">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <CompanyInfoLeft5 />
      <CompanyInfoRight5 />
    </div>
  );
}

function CompaniesSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start pb-[16px] px-[16px] relative shrink-0 w-full" data-name="companies-section">
      <CompanyCard />
      <CompanyCard1 />
      <CompanyCard2 />
      <CompanyCard3 />
      <CompanyCard4 />
      <CompanyCard5 />
    </div>
  );
}

function BodyContent() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body-content">
      <StatusBar />
      <ScreenHeader />
      <SearchAndAction />
      <CompaniesSection />
    </div>
  );
}

function TabIcon() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p24bb9300} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabDashboard() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Dashboard">
      <TabIcon />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Dashboard</p>
    </div>
  );
}

function TabIcon1() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p3c269300} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabSales() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Sales">
      <TabIcon1 />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Sales</p>
    </div>
  );
}

function TabIcon2() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p2ddf9000} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabInventory() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Inventory">
      <TabIcon2 />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Inventory</p>
    </div>
  );
}

function TabIcon3() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p2e5cb170} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabCustomers() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Customers">
      <TabIcon3 />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Customers</p>
    </div>
  );
}

function TabIcon4() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="tab-icon">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="tab-icon">
          <path d={svgPaths.p2db2b980} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function TabMore() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-More">
      <TabIcon4 />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black whitespace-nowrap">More</p>
    </div>
  );
}

function NavTabs() {
  return (
    <div className="content-stretch flex h-[64px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="nav-tabs">
      <TabDashboard />
      <TabSales />
      <TabInventory />
      <TabCustomers />
      <TabMore />
    </div>
  );
}

function HomeIndicator() {
  return (
    <div className="content-stretch flex items-start justify-center py-[8px] relative shrink-0 w-full" data-name="home-indicator">
      <div className="bg-black h-[5px] relative rounded-[100px] shrink-0 w-[139px]" data-name="indicator-bar" />
    </div>
  );
}

function BottomNav() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="bottom-nav">
      <div aria-hidden className="absolute border-[#e5e5e5] border-solid border-t inset-0 pointer-events-none" />
      <NavTabs />
      <HomeIndicator />
    </div>
  );
}

export default function CompaniesList() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="companies-list">
      <BodyContent />
      <BottomNav />
    </div>
  );
}