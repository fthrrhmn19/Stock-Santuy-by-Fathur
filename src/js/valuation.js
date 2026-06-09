export function fairValuePER(eps, targetPer) {
  if (!eps || eps <= 0 || !targetPer || targetPer <= 0) return null;
  return eps * targetPer;
}

export function fairValuePBV(bvps, targetPbv) {
  if (!bvps || bvps <= 0 || !targetPbv || targetPbv <= 0) return null;
  return bvps * targetPbv;
}

export function fairValueDDM(dividend, growth, discountRate) {
  if (!dividend || dividend <= 0 || discountRate <= growth) return null;
  return (dividend * (1 + growth)) / (discountRate - growth);
}

export function fairValueDCF(fcf, growthRate, discountRate, terminalGrowth, shares, years = 5) {
  if (!fcf || fcf <= 0 || !shares || shares <= 0 || discountRate <= terminalGrowth) return null;
  
  let presentValue = 0;
  let currentFcf = fcf;
  
  // Project FCF for N years
  for (let i = 1; i <= years; i++) {
    currentFcf *= (1 + growthRate);
    presentValue += currentFcf / Math.pow(1 + discountRate, i);
  }
  
  // Terminal Value
  const terminalValue = (currentFcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const presentTerminalValue = terminalValue / Math.pow(1 + discountRate, years);
  
  const enterpriseValue = presentValue + presentTerminalValue;
  return enterpriseValue / shares;
}

function determineRiskAndMoS(data, sector) {
  let riskScore = 0;
  if (data.totalDebt > data.equity * 1.5) riskScore += 1; // High Debt
  if (data.operatingCashflow < 0) riskScore += 1; // Negative Cash Flow
  if (data.earningsGrowth < 0) riskScore += 1; // Negative Growth
  if (data.netProfitMargin < 0.05) riskScore += 1; // Low Margin
  
  if (sector === 'Technology' || sector === 'Energy' || sector === 'Basic Materials') riskScore += 1;
  
  if (riskScore === 0) return { level: 'Rendah', mos: 0.15 };
  if (riskScore <= 2) return { level: 'Sedang', mos: 0.20 };
  return { level: 'Tinggi', mos: 0.30 };
}

export function calculateValuationScenarios(data) {
  const sector = data.sector || 'Unknown';
  const price = data.price || 0;
  const risk = determineRiskAndMoS(data, sector);
  
  const baseGrowth = Math.max(Math.min((data.earningsGrowth || data.revenueGrowth || 0.05), 0.20), 0.02); // Cap growth between 2% and 20%
  const basePer = Math.max(Math.min(data.per || 15, 30), 8);
  const basePbv = Math.max(Math.min(data.pbv || 1.5, 5), 0.5);
  
  // Scenarios: Bear, Base, Bull
  const scenarios = {
    bear: {
      growth: baseGrowth * 0.5,
      discountRate: 0.12, // Higher WACC
      terminalGrowth: 0.01,
      targetPer: basePer * 0.8,
      targetPbv: basePbv * 0.8
    },
    base: {
      growth: baseGrowth,
      discountRate: 0.10, // Standard WACC
      terminalGrowth: 0.025,
      targetPer: basePer,
      targetPbv: basePbv
    },
    bull: {
      growth: baseGrowth * 1.5,
      discountRate: 0.08, // Lower WACC
      terminalGrowth: 0.04,
      targetPer: basePer * 1.2,
      targetPbv: basePbv * 1.2
    }
  };

  const results = {};

  ['bear', 'base', 'bull'].forEach(key => {
    const s = scenarios[key];
    const methods = [];
    
    const perVal = fairValuePER(data.eps, s.targetPer);
    const pbvVal = fairValuePBV(data.bookValuePerShare, s.targetPbv);
    const dcfVal = fairValueDCF(data.freeCashflow || data.operatingCashflow, s.growth, s.discountRate, s.terminalGrowth, data.sharesOutstanding);
    const ddmVal = fairValueDDM(data.dividendPerShare, s.terminalGrowth, s.discountRate);
    
    // Weighting logic
    let totalWeight = 0;
    let compositeValue = 0;
    
    const addMethod = (name, value, targetWeight) => {
      if (value) {
        methods.push({ name, value, targetWeight });
        totalWeight += targetWeight;
      }
    };

    if (sector.includes('Bank') || sector.includes('Financial')) {
      addMethod('PBV (ROE Justified)', pbvVal, 45);
      addMethod('PER', perVal, 25);
      addMethod('Dividend Model', ddmVal, 10);
      // DCF usually skipped for banks
    } else if (sector.includes('Real Estate') || sector.includes('Property')) {
      addMethod('PBV', pbvVal, 50);
      addMethod('PER', perVal, 30);
    } else if (sector.includes('Technology') && data.eps <= 0) {
      // Loss making
      const evSalesVal = (data.totalRevenue * 5) / (data.sharesOutstanding || 1); // 5x sales proxy
      addMethod('EV/Sales Proxy', evSalesVal > 0 ? evSalesVal : null, 100);
    } else if (sector.includes('Basic Materials') || sector.includes('Energy')) {
      addMethod('Conservative DCF', dcfVal, 50);
      addMethod('PBV', pbvVal, 30);
      addMethod('PER', perVal, 20);
    } else {
      // General Non-Bank
      addMethod('DCF', dcfVal, 50);
      addMethod('PER', perVal, 20);
      addMethod('PBV', pbvVal, 15);
    }

    // Normalize weights if some methods failed
    let finalComposite = 0;
    const finalMethods = [];
    if (totalWeight > 0) {
      methods.forEach(m => {
        const adjustedWeight = m.targetWeight / totalWeight;
        finalComposite += m.value * adjustedWeight;
        finalMethods.push({ name: m.name, value: m.value, weight: (adjustedWeight * 100).toFixed(0) });
      });
    }

    results[key] = {
      fairValue: finalComposite,
      methods: finalMethods,
      assumptions: {
        growthRate: (s.growth * 100).toFixed(1) + '%',
        discountRate: (s.discountRate * 100).toFixed(1) + '%',
        terminalGrowth: (s.terminalGrowth * 100).toFixed(1) + '%',
        targetPer: s.targetPer.toFixed(1) + 'x',
        targetPbv: s.targetPbv.toFixed(1) + 'x'
      }
    };
  });

  const baseFv = results.base.fairValue;
  const safeBuyPrice = baseFv * (1 - risk.mos);
  const upside = baseFv ? ((baseFv - price) / price) * 100 : 0;
  
  let status = 'Wajar';
  if (upside > 30) status = 'Sangat Murah';
  else if (upside > 10) status = 'Murah';
  else if (upside < -30) status = 'Sangat Mahal';
  else if (upside < -10) status = 'Mahal';

  let confidence = 'Sedang';
  if (results.base.methods.length >= 3 && risk.level === 'Rendah') confidence = 'Tinggi';
  if (results.base.methods.length <= 1 || risk.level === 'Tinggi') confidence = 'Rendah';

  return {
    price,
    scenarios: results,
    composite: baseFv,
    safeBuyPrice,
    upside,
    status,
    confidence,
    marginOfSafety: risk.mos * 100,
    riskLevel: risk.level,
    sector
  };
}
