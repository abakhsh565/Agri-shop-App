import svgPaths from "./svg-upwh8k3hme";

function Signal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_12)" id="signal">
          <path clipRule="evenodd" d={svgPaths.p159df970} fill="black" fillRule="evenodd" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_12">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Wifi() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="wifi">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_10)" id="wifi">
          <path clipRule="evenodd" d={svgPaths.p18941500} fill="black" fillRule="evenodd" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_10">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Battery() {
  return (
    <div className="h-[20px] relative shrink-0 w-[28px]" data-name="battery">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 28 20" width="28">
        <g clipPath="url(#clip0_0_8)" id="battery">
          <path d={svgPaths.p7132ff1} fill="black" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_8">
            <rect fill="white" height="20" width="28" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function StatusIcons() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0" data-name="status-icons">
      <Signal />
      <Wifi />
      <Battery />
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

function ArrowLeft() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="arrowLeft">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_6)" id="arrowLeft">
          <g id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_6">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <ArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Inventory</p>
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Adjust Stock</p>
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

function InfoRow() {
  return (
    <div className="content-stretch flex items-start justify-between relative shrink-0 text-[13px] w-full" data-name="info-row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Variant: 1 Litre Bottle</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Current Stock: 45 Units</p>
    </div>
  );
}

function ProductFocus() {
  return (
    <div className="[word-break:break-word] bg-[#f5f5f5] content-stretch flex flex-col gap-[8px] items-start leading-[normal] p-[20px] relative shrink-0 w-full whitespace-nowrap" data-name="product-focus">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px] uppercase">Active Product</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[18px] text-black">Gabara 10% EC</p>
      <InfoRow />
    </div>
  );
}

function ActionAdd() {
  return (
    <div className="content-stretch flex flex-[1_0_2px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="action-add">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[13px] whitespace-nowrap">+ Add Stock</p>
    </div>
  );
}

function ActionSubtract() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-[1_0_4px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="action-subtract">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">- Deduct Stock</p>
    </div>
  );
}

function ToggleRow() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="toggle-row">
      <ActionAdd />
      <ActionSubtract />
    </div>
  );
}

function AdjustmentType() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="adjustment-type">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Adjustment Action</p>
      <ToggleRow />
    </div>
  );
}

function InputWrapper() {
  return (
    <div className="content-stretch flex h-[48px] items-center px-[16px] relative rounded-[24px] shrink-0 w-full" data-name="input-wrapper">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">5</p>
    </div>
  );
}

function InputField() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="input-field">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Adjustment Quantity</p>
      <InputWrapper />
    </div>
  );
}

function ChevronDown() {
  return (
    <div className="overflow-clip relative shrink-0 size-[16px]" data-name="chevronDown">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="chevron-down">
          <path d="M4 6L8 10L12 6" id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function InputWrapper1() {
  return (
    <div className="content-stretch flex h-[48px] items-center justify-between px-[16px] relative rounded-[24px] shrink-0 w-full" data-name="input-wrapper">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Damaged during handling</p>
      <ChevronDown />
    </div>
  );
}

function DropdownField() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="dropdown-field">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Reason for Correction</p>
      <InputWrapper1 />
    </div>
  );
}

function InputWrapper2() {
  return (
    <div className="content-stretch flex h-[48px] items-center px-[16px] relative rounded-[24px] shrink-0 w-full" data-name="input-wrapper">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Found leaking during monthly manual count</p>
    </div>
  );
}

function InputField1() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="input-field">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Internal Audit Notes</p>
      <InputWrapper2 />
    </div>
  );
}

function Row() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[13px] text-black w-full whitespace-nowrap" data-name="row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0">Original Stock</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">45 Units</p>
    </div>
  );
}

function Row1() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[#888] text-[13px] w-full whitespace-nowrap" data-name="row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0">Deduction</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">- 5 Units</p>
    </div>
  );
}

function Row2() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-start justify-between leading-[normal] relative shrink-0 text-black w-full whitespace-nowrap" data-name="row">
      <p className="relative shrink-0 text-[13px]">New Forecasted Stock</p>
      <p className="relative shrink-0 text-[16px]">40 Units</p>
    </div>
  );
}

function AdjustmentPreview() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col gap-[4px] items-start p-[16px] relative rounded-[8px] shrink-0 w-full" data-name="adjustment-preview">
      <Row />
      <Row1 />
      <div className="bg-[#e5e5e5] h-px relative shrink-0 w-full" data-name="line" />
      <Row2 />
    </div>
  );
}

function AdjustmentForm() {
  return (
    <div className="content-stretch flex flex-col gap-[20px] items-start p-[16px] relative shrink-0 w-full" data-name="adjustment-form">
      <AdjustmentType />
      <InputField />
      <DropdownField />
      <InputField1 />
      <AdjustmentPreview />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <ProductFocus />
      <AdjustmentForm />
    </div>
  );
}

function BtnConfirm() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-confirm">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Confirm Stock Correction</p>
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

function Footer() {
  return (
    <div className="content-stretch flex flex-col items-start p-[24px] relative shrink-0 w-full" data-name="footer">
      <BtnConfirm />
      <HomeIndicator />
    </div>
  );
}

export default function StockAdjustment() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="stock-adjustment">
      <Body />
      <Footer />
    </div>
  );
}