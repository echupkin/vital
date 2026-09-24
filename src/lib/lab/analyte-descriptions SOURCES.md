# Analyte description sources

Audit trail for `analyte-descriptions.json`. One row per described analyte: the single
patient-facing source each entry was taken from, the date it was opened, and whether
every checkable claim (number, threshold, range, category name, or named health
consequence) in that entry was confirmed against that page.

The **claims** column records the outcome of the audit:

- `checked` — every checkable claim in the entry appears on the cited page as written.
- `checked, reworded` — the page supports the substance but not the exact wording, so the
  entry was rewritten in the source's own words (any unsupported figure was removed).
- `checked, re-cited` — the claim is not on the original page, so the entry was re-pointed to
  an allowlisted page that states it.

All sources are MedlinePlus (U.S. National Library of Medicine) or Labcorp patient test
information.

Date all sources opened: 2026-09-23

| analyte key | source title | URL | date opened | claims |
| --- | --- | --- | --- | --- |
| `total_cholesterol` | MedlinePlus — Cholesterol Levels | https://medlineplus.gov/lab-tests/cholesterol-levels/ | 2026-09-23 | checked, reworded |
| `ldl_c` | MedlinePlus — Cholesterol Levels | https://medlineplus.gov/lab-tests/cholesterol-levels/ | 2026-09-23 | checked, reworded |
| `hdl_c` | MedlinePlus — Cholesterol Levels | https://medlineplus.gov/lab-tests/cholesterol-levels/ | 2026-09-23 | checked, reworded |
| `triglycerides` | MedlinePlus — Cholesterol Levels: What You Need to Know | https://medlineplus.gov/cholesterollevelswhatyouneedtoknow.html | 2026-09-23 | checked |
| `non_hdl_cholesterol` | MedlinePlus — Cholesterol Levels: What You Need to Know | https://medlineplus.gov/cholesterollevelswhatyouneedtoknow.html | 2026-09-23 | checked, reworded |
| `cholesterol_hdl_ratio` | Labcorp — Lipid Panel With Total Cholesterol:HDL Ratio | https://www.labcorp.com/tests/221010/lipid-panel-with-total-cholesterol-hdl-ratio | 2026-09-23 | checked, reworded |
| `ldl_hdl_ratio` | Labcorp — Lipid Panel With LDL:HDL Ratio | https://www.labcorp.com/tests/235010/lipid-panel-with-ldl-hdl-ratio | 2026-09-23 | checked |
| `apob` | Labcorp — Apolipoprotein B | https://www.labcorp.com/tests/167015/apolipoprotein-b | 2026-09-23 | checked, reworded |
| `lpa` | MedlinePlus — Lipoprotein (a) Blood Test | https://medlineplus.gov/lab-tests/lipoprotein-a-blood-test/ | 2026-09-23 | checked |
| `glucose_fasting` | MedlinePlus — Blood Glucose Test | https://medlineplus.gov/lab-tests/blood-glucose-test/ | 2026-09-23 | checked |
| `hba1c` | MedlinePlus — Hemoglobin A1C (HbA1c) Test | https://medlineplus.gov/lab-tests/hemoglobin-a1c-hba1c-test/ | 2026-09-23 | checked |
| `insulin` | MedlinePlus — Insulin in Blood | https://medlineplus.gov/lab-tests/insulin-in-blood/ | 2026-09-23 | checked |
| `c_peptide` | MedlinePlus — C-Peptide Test | https://medlineplus.gov/lab-tests/c-peptide-test/ | 2026-09-23 | checked |
| `wbc` | MedlinePlus — White Blood Count (WBC) | https://medlineplus.gov/lab-tests/white-blood-count-wbc/ | 2026-09-23 | checked |
| `rbc` | MedlinePlus — Red Blood Cell (RBC) Count | https://medlineplus.gov/lab-tests/red-blood-cell-rbc-count/ | 2026-09-23 | checked |
| `hemoglobin` | MedlinePlus — Hemoglobin Test | https://medlineplus.gov/lab-tests/hemoglobin-test/ | 2026-09-23 | checked |
| `hematocrit` | MedlinePlus — Hematocrit Test | https://medlineplus.gov/lab-tests/hematocrit-test/ | 2026-09-23 | checked |
| `mcv` | MedlinePlus — MCV (Mean Corpuscular Volume) | https://medlineplus.gov/lab-tests/mcv-mean-corpuscular-volume/ | 2026-09-23 | checked |
| `mch` | MedlinePlus — Red Blood Cell (RBC) Indices | https://medlineplus.gov/lab-tests/red-blood-cell-rbc-indices/ | 2026-09-23 | checked |
| `mchc` | MedlinePlus — Red Blood Cell (RBC) Indices | https://medlineplus.gov/lab-tests/red-blood-cell-rbc-indices/ | 2026-09-23 | checked |
| `rdw` | MedlinePlus — Red Blood Cell (RBC) Indices | https://medlineplus.gov/lab-tests/red-blood-cell-rbc-indices/ | 2026-09-23 | checked, reworded |
| `platelets` | MedlinePlus — Platelet Tests | https://medlineplus.gov/lab-tests/platelet-tests/ | 2026-09-23 | checked |
| `mpv` | MedlinePlus — MPV Blood Test | https://medlineplus.gov/lab-tests/mpv-blood-test/ | 2026-09-23 | checked |
| `neutrophils` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked |
| `lymphocytes` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked |
| `monocytes` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked |
| `eosinophils` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked |
| `basophils` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked |
| `neutrophils_abs` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked, reworded |
| `lymphocytes_abs` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked, reworded |
| `monocytes_abs` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked, reworded |
| `eosinophils_abs` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked, reworded |
| `basophils_abs` | MedlinePlus — Blood Differential | https://medlineplus.gov/lab-tests/blood-differential/ | 2026-09-23 | checked, reworded |
| `alt` | MedlinePlus — ALT Blood Test | https://medlineplus.gov/lab-tests/alt-blood-test/ | 2026-09-23 | checked |
| `ast` | MedlinePlus — AST Test | https://medlineplus.gov/lab-tests/ast-test/ | 2026-09-23 | checked |
| `alp` | MedlinePlus — Alkaline Phosphatase | https://medlineplus.gov/lab-tests/alkaline-phosphatase/ | 2026-09-23 | checked |
| `ggt` | MedlinePlus — Gamma-glutamyl Transferase (GGT) Test | https://medlineplus.gov/lab-tests/gamma-glutamyl-transferase-ggt-test/ | 2026-09-23 | checked |
| `total_bilirubin` | MedlinePlus — Bilirubin Blood Test | https://medlineplus.gov/lab-tests/bilirubin-blood-test/ | 2026-09-23 | checked |
| `direct_bilirubin` | MedlinePlus — Bilirubin Blood Test | https://medlineplus.gov/lab-tests/bilirubin-blood-test/ | 2026-09-23 | checked |
| `albumin` | MedlinePlus — Albumin Blood Test | https://medlineplus.gov/lab-tests/albumin-blood-test/ | 2026-09-23 | checked |
| `total_protein` | MedlinePlus — Total Protein and Albumin/Globulin (A/G) Ratio | https://medlineplus.gov/lab-tests/total-protein-and-albumin-globulin-a-g-ratio/ | 2026-09-23 | checked, reworded |
| `globulin` | MedlinePlus — Total Protein and Albumin/Globulin (A/G) Ratio | https://medlineplus.gov/lab-tests/total-protein-and-albumin-globulin-a-g-ratio/ | 2026-09-23 | checked |
| `albumin_globulin_ratio` | MedlinePlus — Total Protein and Albumin/Globulin (A/G) Ratio | https://medlineplus.gov/lab-tests/total-protein-and-albumin-globulin-a-g-ratio/ | 2026-09-23 | checked, reworded |
| `creatinine` | MedlinePlus — Creatinine Test | https://medlineplus.gov/lab-tests/creatinine-test/ | 2026-09-23 | checked |
| `egfr` | MedlinePlus — Glomerular Filtration Rate (GFR) Test | https://medlineplus.gov/lab-tests/glomerular-filtration-rate-gfr-test/ | 2026-09-23 | checked, reworded |
| `bun` | MedlinePlus — BUN (Blood Urea Nitrogen) | https://medlineplus.gov/lab-tests/bun-blood-urea-nitrogen/ | 2026-09-23 | checked |
| `bun_creatinine_ratio` | MedlinePlus — Creatinine Test | https://medlineplus.gov/lab-tests/creatinine-test/ | 2026-09-23 | checked, re-cited |
| `uric_acid` | MedlinePlus — Uric Acid Test | https://medlineplus.gov/lab-tests/uric-acid-test/ | 2026-09-23 | checked |
| `sodium` | MedlinePlus — Electrolyte Panel | https://medlineplus.gov/lab-tests/electrolyte-panel/ | 2026-09-23 | checked |
| `potassium` | MedlinePlus — Electrolyte Panel | https://medlineplus.gov/lab-tests/electrolyte-panel/ | 2026-09-23 | checked |
| `chloride` | MedlinePlus — Electrolyte Panel | https://medlineplus.gov/lab-tests/electrolyte-panel/ | 2026-09-23 | checked |
| `co2_bicarbonate` | MedlinePlus — Electrolyte Panel | https://medlineplus.gov/lab-tests/electrolyte-panel/ | 2026-09-23 | checked |
| `calcium` | MedlinePlus — Calcium Blood Test | https://medlineplus.gov/lab-tests/calcium-blood-test/ | 2026-09-23 | checked, re-cited |
| `magnesium` | MedlinePlus — Magnesium Blood Test | https://medlineplus.gov/lab-tests/magnesium-blood-test/ | 2026-09-23 | checked |
| `phosphorus` | MedlinePlus — Phosphate in Blood | https://medlineplus.gov/lab-tests/phosphate-in-blood/ | 2026-09-23 | checked, re-cited |
| `anion_gap` | MedlinePlus — Anion Gap Blood Test | https://medlineplus.gov/lab-tests/anion-gap-blood-test/ | 2026-09-23 | checked |
| `tsh` | MedlinePlus — TSH (Thyroid-stimulating hormone) Test | https://medlineplus.gov/lab-tests/tsh-thyroid-stimulating-hormone-test/ | 2026-09-23 | checked |
| `free_t4` | MedlinePlus — Thyroxine (T4) Test | https://medlineplus.gov/lab-tests/thyroxine-t4-test/ | 2026-09-23 | checked |
| `free_t3` | MedlinePlus — Triiodothyronine (T3) Tests | https://medlineplus.gov/lab-tests/triiodothyronine-t3-tests/ | 2026-09-23 | checked |
| `total_t4` | MedlinePlus — Thyroxine (T4) Test | https://medlineplus.gov/lab-tests/thyroxine-t4-test/ | 2026-09-23 | checked |
| `total_t3` | MedlinePlus — Triiodothyronine (T3) Tests | https://medlineplus.gov/lab-tests/triiodothyronine-t3-tests/ | 2026-09-23 | checked |
| `ferritin` | MedlinePlus — Ferritin Blood Test | https://medlineplus.gov/lab-tests/ferritin-blood-test/ | 2026-09-23 | checked |
| `iron` | MedlinePlus — Iron Tests | https://medlineplus.gov/lab-tests/iron-tests/ | 2026-09-23 | checked |
| `tibc` | MedlinePlus — Iron Tests | https://medlineplus.gov/lab-tests/iron-tests/ | 2026-09-23 | checked |
| `transferrin_saturation` | Labcorp — Iron and Total Iron-binding Capacity (TIBC) | https://www.labcorp.com/tests/001321/iron-and-total-iron-binding-capacity-tibc | 2026-09-23 | checked, re-cited |
| `vitamin_b12` | MedlinePlus — Vitamin B Test | https://medlineplus.gov/lab-tests/vitamin-b-test/ | 2026-09-23 | checked |
| `folate` | MedlinePlus — Folic acid - test | https://medlineplus.gov/ency/article/003686.htm | 2026-09-23 | checked |
| `vitamin_d_25oh` | MedlinePlus — Vitamin D Test | https://medlineplus.gov/lab-tests/vitamin-d-test/ | 2026-09-23 | checked, re-cited |
| `hs_crp` | MedlinePlus — C-Reactive Protein (CRP) Test | https://medlineplus.gov/lab-tests/c-reactive-protein-crp-test/ | 2026-09-23 | checked |
| `crp` | MedlinePlus — C-Reactive Protein (CRP) Test | https://medlineplus.gov/lab-tests/c-reactive-protein-crp-test/ | 2026-09-23 | checked |
| `esr` | MedlinePlus — Erythrocyte Sedimentation Rate (ESR) | https://medlineplus.gov/lab-tests/erythrocyte-sedimentation-rate-esr/ | 2026-09-23 | checked |
| `homocysteine` | MedlinePlus — Homocysteine Test | https://medlineplus.gov/lab-tests/homocysteine-test/ | 2026-09-23 | checked |
| `total_testosterone` | MedlinePlus — Testosterone Levels Test | https://medlineplus.gov/lab-tests/testosterone-levels-test/ | 2026-09-23 | checked |
| `free_testosterone` | MedlinePlus — Testosterone Levels Test | https://medlineplus.gov/lab-tests/testosterone-levels-test/ | 2026-09-23 | checked |
| `estradiol` | MedlinePlus — Estrogen Levels Test | https://medlineplus.gov/lab-tests/estrogen-levels-test/ | 2026-09-23 | checked |
| `shbg` | Labcorp — Sex Hormone-binding Globulin | https://www.labcorp.com/tests/082016/sex-hormone-binding-globulin | 2026-09-23 | checked |
| `psa` | MedlinePlus — Prostate-Specific Antigen (PSA) Test | https://medlineplus.gov/lab-tests/prostate-specific-antigen-psa-test/ | 2026-09-23 | checked |
| `lh` | MedlinePlus — Luteinizing Hormone (LH) Levels Test | https://medlineplus.gov/lab-tests/luteinizing-hormone-lh-levels-test/ | 2026-09-23 | checked |
| `fsh` | MedlinePlus — Follicle-Stimulating Hormone (FSH) Levels Test | https://medlineplus.gov/lab-tests/follicle-stimulating-hormone-fsh-levels-test/ | 2026-09-23 | checked |
| `dhea_s` | MedlinePlus — DHEA Sulfate Test | https://medlineplus.gov/lab-tests/dhea-sulfate-test/ | 2026-09-23 | checked |
| `cortisol_am` | MedlinePlus — Cortisol Test | https://medlineplus.gov/lab-tests/cortisol-test/ | 2026-09-23 | checked |
| `igf_1` | MedlinePlus — IGF-1 (Insulin-like Growth Factor 1) Test | https://medlineplus.gov/lab-tests/igf-1-insulin-like-growth-factor-1-test/ | 2026-09-23 | checked |
| `inr` | MedlinePlus — Prothrombin Time Test and INR (PT/INR) | https://medlineplus.gov/lab-tests/prothrombin-time-test-and-inr-ptinr/ | 2026-09-23 | checked |
| `pt` | MedlinePlus — Prothrombin Time Test and INR (PT/INR) | https://medlineplus.gov/lab-tests/prothrombin-time-test-and-inr-ptinr/ | 2026-09-23 | checked |
| `aptt` | MedlinePlus — Partial Thromboplastin Time (PTT) Test | https://medlineplus.gov/lab-tests/partial-thromboplastin-time-ptt-test/ | 2026-09-23 | checked |
| `fibrinogen` | MedlinePlus — Fibrinogen blood test | https://medlineplus.gov/ency/article/003650.htm | 2026-09-23 | checked |
| `d_dimer` | MedlinePlus — D-Dimer Test | https://medlineplus.gov/lab-tests/d-dimer-test/ | 2026-09-23 | checked |
| `troponin_hs` | MedlinePlus — Troponin Test | https://medlineplus.gov/lab-tests/troponin-test/ | 2026-09-23 | checked |
| `bnp` | MedlinePlus — Natriuretic Peptide Tests (BNP, NT-proBNP) | https://medlineplus.gov/lab-tests/natriuretic-peptide-tests-bnp-nt-probnp/ | 2026-09-23 | checked |
| `nt_probnp` | MedlinePlus — Natriuretic Peptide Tests (BNP, NT-proBNP) | https://medlineplus.gov/lab-tests/natriuretic-peptide-tests-bnp-nt-probnp/ | 2026-09-23 | checked |
| `ck` | MedlinePlus — Creatine Kinase | https://medlineplus.gov/lab-tests/creatine-kinase/ | 2026-09-23 | checked |
