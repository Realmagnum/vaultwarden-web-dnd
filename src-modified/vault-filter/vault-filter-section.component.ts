// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Component, computed, inject, input, InjectionToken, Injector, Input, output } from "@angular/core";
import { toObservable, toSignal } from "@angular/core/rxjs-interop";
import { firstValueFrom, Observable } from "rxjs";
import { map, switchMap } from "rxjs/operators";

import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { CollectionService } from "@bitwarden/admin-console/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherId, CollectionId, OrganizationId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { ITreeNodeObject, TreeNode } from "@bitwarden/common/vault/models/domain/tree-node";
import { DialogService, ToastService } from "@bitwarden/components";
import {
  VaultFilterServiceAbstraction as VaultFilterService,
  VaultFilterSection,
  VaultFilterType,
  VaultFilter,
} from "@bitwarden/vault";

import { AssignCollectionsWebComponent } from "../../../../components/assign-collections/assign-collections-web.component";
import { CoachmarkService } from "../../../../components/coachmark";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-filter-section",
  templateUrl: "vault-filter-section.component.html",
  standalone: false,
})
export class VaultFilterSectionComponent {
  private activeUserId$ = getUserId(this.accountService.activeAccount$);

  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() activeFilter: VaultFilter;
  readonly section = input.required<VaultFilterSection>();

  /** Whether this section is the collection filter (enables coachmark) */
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() isCollectionFilter = false;

  protected readonly coachmarkService = inject(CoachmarkService);

  /** Computed signal for collections coachmark open state */
  protected readonly collectionsCoachmarkOpen = computed(
    () => this.coachmarkService.activeStepId() === "shareWithCollections",
  );

  readonly data = toSignal(toObservable(this.section).pipe(switchMap((s) => s.data$)), {
    initialValue: undefined,
  });
  readonly collapsedFilterNodes = toSignal(this.vaultFilterService.collapsedFilterNodes$, {
    initialValue: new Set<string>(),
  });

  protected readonly headerNode = computed(() => this.data()!);
  protected readonly headerInfo = computed(() => this.section().header);
  protected readonly filters = computed(() => this.data()?.children);
  protected readonly isOrganizationFilter = computed(
    () => this.data()?.node instanceof Organization,
  );
  protected readonly isAllVaultsSelected = computed(
    () => this.isOrganizationFilter() && !this.activeFilter.selectedOrganizationNode,
  );
  protected readonly editInfo = computed(() => this.section().edit);
  protected readonly addInfo = computed(() => this.section().add);
  protected readonly showAddLink = computed(() => !!this.section().add?.route);
  protected readonly optionsInfo = computed(() => this.section().options);
  protected readonly premiumFeature = computed(
    () => this.section().premiumOptions?.showBadgeForNonPremium,
  );
  protected readonly divider = computed(() => this.section().divider);

  private injectors = new Map<string, Injector>();

  readonly dragStarted = output<boolean>();
  private draggingCipherId?: CipherId;

  constructor(
    private vaultFilterService: VaultFilterService,
    private injector: Injector,
    private accountService: AccountService,
    private cipherService: CipherService,
    private collectionService: CollectionService,
    private dialogService: DialogService,
    private toastService: ToastService,
    private i18nService: I18nService,
  ) {}

  isNodeSelected(filterNode: TreeNode<VaultFilterType>) {
    const { organizationId, cipherTypeId, folderId, collectionId, isCollectionSelected } =
      this.activeFilter;

    const collectionStatus =
      filterNode?.node.id === "AllCollections" &&
      (isCollectionSelected || collectionId === "AllCollections");

    return (
      organizationId === filterNode?.node.id ||
      cipherTypeId === filterNode?.node.id ||
      folderId === filterNode?.node.id ||
      collectionStatus
    );
  }

  async onFilterSelect(filterNode: TreeNode<VaultFilterType>) {
    if (this.section().premiumOptions?.blockFilterAction) {
      await this.section().premiumOptions.blockFilterAction();
      return;
    }

    await this.section().action(filterNode);
  }

  onEdit(filterNode: TreeNode<VaultFilterType>) {
    this.section().edit?.action(filterNode.node);
  }

  async onAdd() {
    this.section().add?.action();
  }

  isCollapsed(node: ITreeNodeObject) {
    return this.collapsedFilterNodes().has(node.id);
  }

  async toggleCollapse(node: ITreeNodeObject) {
    const nodes = this.collapsedFilterNodes();
    if (nodes.has(node.id)) {
      nodes.delete(node.id);
    } else {
      nodes.add(node.id);
    }
    const userId = await firstValueFrom(this.activeUserId$);
    await this.vaultFilterService.setCollapsedFilterNodes(nodes, userId);
  }

  // an injector is necessary to pass data into a dynamic component
  // here we are creating a new injector for each filter that has options
  createInjector(data: VaultFilterType) {
    let inject = this.injectors.get(data.id);

    if (!inject) {
      // Pass an observable to the component in order to update the component when the data changes
      // as data binding does not work with dynamic components in Angular 15 (inputs are supported starting Angular 16)
      const data$ = this.section().data$.pipe(
        map((sectionNode) => sectionNode?.children?.find((node) => node.node.id === data.id)?.node),
      );
      inject = Injector.create({
        providers: [{ provide: OptionsInput, useValue: data$ }],
        parent: this.injector,
      });
      this.injectors.set(data.id, inject);
    }
    return inject;
  }

  protected draggedOverNodeId: string | null = null;

  isDragOver(nodeId: string): boolean {
    return this.draggedOverNodeId === nodeId;
  }

  onFilterDragOver(event: DragEvent, filterNode: TreeNode<VaultFilterType>) {
    if (!filterNode?.node?.id) {
      return;
    }
    if (event.dataTransfer?.types.includes("application/json")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      this.draggedOverNodeId = filterNode.node.id;
    }
  }

  onFilterDragLeave(event: DragEvent, filterNode: TreeNode<VaultFilterType>) {
    if (this.draggedOverNodeId === filterNode?.node?.id) {
      this.draggedOverNodeId = null;
    }
  }

  async onFilterDrop(event: DragEvent, filterNode: TreeNode<VaultFilterType>) {
    event.preventDefault();
    this.draggedOverNodeId = null;

    const rawData = event.dataTransfer?.getData("application/json");
    if (!rawData) {
      return;
    }

    let dragData: {
      cipherId: string;
      cipherName: string;
      organizationId: string | null;
      collectionIds: string[];
      folderId: string | null;
    };
    try {
      dragData = JSON.parse(rawData);
    } catch {
      return;
    }

    if (!dragData?.cipherId) {
      return;
    }

    const userId = await firstValueFrom(this.activeUserId$);
    if (!userId) {
      return;
    }

    const targetNode = filterNode.node;
    const targetId = targetNode.id;
    const targetName = targetNode.name;

    // 1. Dropping onto Collections
    if (this.isCollectionFilter) {
      if (targetId === "AllCollections") {
        return;
      }
      const targetOrgId = (targetNode as any).organizationId as OrganizationId;
      const targetReadOnly = (targetNode as any).readOnly;

      if (targetReadOnly) {
        this.toastService.showToast({
          variant: "error",
          title: this.i18nService.t("errorOccurred"),
          message: this.i18nService.t("readOnly"),
        });
        return;
      }

      // 1a. Same organization move: Org A -> Org A
      if (dragData.organizationId && targetOrgId && dragData.organizationId === targetOrgId) {
        try {
          // Add to target collection
          await this.cipherService.bulkUpdateCollectionsWithServer(
            targetOrgId,
            userId,
            [dragData.cipherId as CipherId],
            [targetId as CollectionId],
            false,
          );

          // If active filter is another collection (and not AllCollections), remove from previous collection
          const activeColId = this.activeFilter?.collectionId;
          if (activeColId && activeColId !== targetId && activeColId !== "AllCollections") {
            await this.cipherService.bulkUpdateCollectionsWithServer(
              targetOrgId,
              userId,
              [dragData.cipherId as CipherId],
              [activeColId as CollectionId],
              true,
            );
          }

          this.toastService.showToast({
            variant: "success",
            title: null,
            message: `"${dragData.cipherName}" → "${targetName}"`,
          });
        } catch (e: any) {
          this.toastService.showToast({
            variant: "error",
            title: this.i18nService.t("errorOccurred"),
            message: String(e?.message || e),
          });
        }
        return;
      }

      // 1b. Personal item to Organization collection (ownership transfer)
      if (!dragData.organizationId && targetOrgId) {
        const cipherView = await firstValueFrom(
          this.cipherService.cipherView$(userId, dragData.cipherId as CipherId),
        );
        if (!cipherView) {
          return;
        }

        const allCollections = await firstValueFrom(
          this.collectionService.decryptedCollections$(userId),
        );
        const availableCollections = allCollections.filter((c) => c.organizationId === targetOrgId);

        AssignCollectionsWebComponent.open(this.dialogService, {
          data: {
            ciphers: [cipherView],
            organizationId: targetOrgId,
            availableCollections,
            activeCollection: targetNode as any,
          },
        });
        return;
      }

      // 1c. Different organizations: Org A -> Org B (disallowed)
      if (dragData.organizationId && targetOrgId && dragData.organizationId !== targetOrgId) {
        this.toastService.showToast({
          variant: "error",
          title: this.i18nService.t("errorOccurred"),
          message: "Cannot move items between different organizations directly.",
        });
        return;
      }
    }

    // 2. Dropping onto Organization (in organizationFilter)
    if (this.isOrganizationFilter() && targetId && targetId !== "MyVault" && targetId !== "AllVaults") {
      if (!dragData.organizationId) {
        const cipherView = await firstValueFrom(
          this.cipherService.cipherView$(userId, dragData.cipherId as CipherId),
        );
        if (!cipherView) {
          return;
        }

        const allCollections = await firstValueFrom(
          this.collectionService.decryptedCollections$(userId),
        );
        const availableCollections = allCollections.filter((c) => c.organizationId === targetId);

        AssignCollectionsWebComponent.open(this.dialogService, {
          data: {
            ciphers: [cipherView],
            organizationId: targetId as OrganizationId,
            availableCollections,
          },
        });
        return;
      } else if (dragData.organizationId !== targetId) {
        this.toastService.showToast({
          variant: "error",
          title: this.i18nService.t("errorOccurred"),
          message: "Cannot move items between different organizations directly.",
        });
        return;
      }
    }

    // 3. Dropping onto Personal Folders
    const isFolderFilter = !this.isCollectionFilter && !this.isOrganizationFilter();
    if (isFolderFilter && targetId) {
      if (targetId === "none" || targetId === "AllFolders") {
        return;
      }
      try {
        await this.cipherService.moveManyWithServer([dragData.cipherId], targetId, userId);
        this.toastService.showToast({
          variant: "success",
          title: null,
          message: `"${dragData.cipherName}" → "${targetName}"`,
        });
      } catch (e: any) {
        this.toastService.showToast({
          variant: "error",
          title: this.i18nService.t("errorOccurred"),
          message: String(e?.message || e),
        });
      }
      return;
    }
  }
}
export const OptionsInput = new InjectionToken<Observable<VaultFilterType>>("OptionsInput");
