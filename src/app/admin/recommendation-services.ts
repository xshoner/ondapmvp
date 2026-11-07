'use client';

import type { AdminSyncUiServices, RecommendationServices } from '@/recommendation/contracts.ts';
import {
  recommendForCustomer,
  loadAdminWorkspace,
  loadProductAssessment,
  saveProductAssessment,
  suggestProductAssessment,
  loadCorePolicy,
  saveCorePolicy,
  previewForAdmin,
} from '@/recommendation/server.ts';
import {
  previewCafe24SyncAction,
  applyCafe24SyncAction,
} from './formality/sync-actions.ts';

export const adminRecommendationServices: RecommendationServices = {
  recommend: (req) => recommendForCustomer(req),
  loadWorkspace: () => loadAdminWorkspace(),
  loadAssessment: (pNo) => loadProductAssessment(pNo),
  saveAssessment: (cmd) => saveProductAssessment(cmd),
  suggestAssessment: (cmd) => suggestProductAssessment(cmd),
  loadPolicy: () => loadCorePolicy(),
  savePolicy: (cmd) => saveCorePolicy(cmd),
  previewRecommendation: (cmd) => previewForAdmin(cmd),
};

export const adminSyncServices: AdminSyncUiServices = {
  preview: () => previewCafe24SyncAction(),
  apply: (cmd) => applyCafe24SyncAction(cmd),
};
