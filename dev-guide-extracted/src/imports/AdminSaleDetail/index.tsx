import svgPaths from "./svg-zxe2jvjni3";

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
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Sales</p>
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[18px] text-black text-center whitespace-nowrap">Sale Details #TX-9821</p>
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

function Frame1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col font-['Geist:Bold',sans-serif] font-bold gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-[#888] text-[12px] uppercase">Customer</p>
      <p className="relative shrink-0 text-[18px] text-black">Rashid Ali</p>
    </div>
  );
}

function StatusBadge() {
  return (
    <div className="bg-black content-stretch flex items-start px-[12px] py-[6px] relative rounded-[16px] shrink-0" data-name="status-badge">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-white uppercase whitespace-nowrap">Paid Sale</p>
    </div>
  );
}

function RowPrimary() {
  return (
    <div className="content-stretch flex flex-[1_0_0] items-center justify-between min-w-px relative" data-name="row-primary">
      <Frame1 />
      <StatusBadge />
    </div>
  );
}

function RowSecondary() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] font-['Geist:Regular',sans-serif] font-normal items-center justify-between leading-[normal] min-w-px relative text-[#888] text-[13px] whitespace-nowrap" data-name="row-secondary">
      <p className="relative shrink-0">Sold by: Ahmed Khan</p>
      <p className="relative shrink-0">10:32 AM • Oct 26</p>
    </div>
  );
}

function OverviewPanel() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex gap-[16px] items-start p-[20px] relative shrink-0 w-full" data-name="overview-panel">
      <RowPrimary />
      <RowSecondary />
    </div>
  );
}

function Frame2() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-center justify-between leading-[normal] relative shrink-0 text-[14px] text-black w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0">FMC Spray (250ml)</p>
      <p className="relative shrink-0">Rs. 3,000</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Regular',sans-serif] font-normal items-center justify-between leading-[normal] relative shrink-0 text-[#888] w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-[12px]">Price: Rs. 1,500 x 2 units</p>
      <p className="relative shrink-0 text-[11px]">Cost: Rs. 1,100</p>
    </div>
  );
}

function AdminProfitStrip() {
  return (
    <div className="[word-break:break-word] bg-[#f5f5f5] content-stretch flex items-start justify-between leading-[normal] px-[8px] py-[4px] relative rounded-[4px] shrink-0 text-[11px] w-full whitespace-nowrap" data-name="admin-profit-strip">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Total Cost: Rs. 2,200</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[#10b981]">Margin Profit: Rs. 800</p>
    </div>
  );
}

function ItemRow() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start p-[16px] relative shrink-0 w-full" data-name="item-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <Frame2 />
      <Frame3 />
      <AdminProfitStrip />
    </div>
  );
}

function Frame4() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-center justify-between leading-[normal] relative shrink-0 text-[14px] text-black w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0">Syngenta Seeds (Hybrid)</p>
      <p className="relative shrink-0">Rs. 6,200</p>
    </div>
  );
}

function Frame5() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Regular',sans-serif] font-normal items-center justify-between leading-[normal] relative shrink-0 text-[#888] w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-[12px]">Price: Rs. 6,200 x 1 unit</p>
      <p className="relative shrink-0 text-[11px]">Cost: Rs. 4,500</p>
    </div>
  );
}

function AdminProfitStrip1() {
  return (
    <div className="[word-break:break-word] bg-[#f5f5f5] content-stretch flex items-start justify-between leading-[normal] px-[8px] py-[4px] relative rounded-[4px] shrink-0 text-[11px] w-full whitespace-nowrap" data-name="admin-profit-strip">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Total Cost: Rs. 4,500</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[#10b981]">Margin Profit: Rs. 1,700</p>
    </div>
  );
}

function ItemRow1() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start p-[16px] relative shrink-0 w-full" data-name="item-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <Frame4 />
      <Frame5 />
      <AdminProfitStrip1 />
    </div>
  );
}

function ItemsList() {
  return (
    <div className="relative rounded-[12px] shrink-0 w-full" data-name="items-list">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <ItemRow />
        <ItemRow1 />
      </div>
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function ItemsSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="items-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] uppercase whitespace-nowrap">Items Sold</p>
      <ItemsList />
    </div>
  );
}

function DetailRow() {
  return (
    <div className="content-stretch flex items-center justify-between px-[16px] py-[12px] relative shrink-0 w-full" data-name="detail-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[14px] whitespace-nowrap">Total Base Cost</p>
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 6,700</p>
    </div>
  );
}

function DetailRow1() {
  return (
    <div className="content-stretch flex items-center justify-between px-[16px] py-[12px] relative shrink-0 w-full" data-name="detail-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[14px] whitespace-nowrap">Subtotal Invoice</p>
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 9,200</p>
    </div>
  );
}

function DetailRow2() {
  return (
    <div className="content-stretch flex items-center justify-between px-[16px] py-[12px] relative shrink-0 w-full" data-name="detail-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[14px] whitespace-nowrap">Net Profit</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#10b981] text-[14px] whitespace-nowrap">Rs. 2,500</p>
    </div>
  );
}

function SummaryContainer() {
  return (
    <div className="relative rounded-[12px] shrink-0 w-full" data-name="summary-container">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <DetailRow />
        <DetailRow1 />
        <DetailRow2 />
      </div>
      <div aria-hidden className="absolute border-[1.5px] border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function AdminSummary() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="admin-summary">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] uppercase whitespace-nowrap">{`Cost & Profit Summary (Admin)`}</p>
      <SummaryContainer />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <OverviewPanel />
      <ItemsSection />
      <AdminSummary />
    </div>
  );
}

function BtnSecondary() {
  return (
    <div className="content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-secondary">
      <div aria-hidden className="absolute border-[1.5px] border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Edit Transaction</p>
    </div>
  );
}

function Footer() {
  return (
    <div className="content-stretch flex flex-col items-start p-[16px] relative shrink-0 w-full" data-name="footer">
      <BtnSecondary />
    </div>
  );
}

export default function AdminSaleDetail() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="admin-sale-detail">
      <Body />
      <Footer />
    </div>
  );
}