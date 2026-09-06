'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Loader2 } from 'lucide-react';

type AudienceTier = 0 | 1 | 2;

interface PublishDialogProps {
  open: boolean;
  stageId: string;
  onOpenChange: (open: boolean) => void;
  onPublishSuccess?: () => void;
}

/**
 * Publish dialog with an audience picker.
 *
 * Renders radio buttons for the three audience tiers (everyone, guests, learners)
 * and calls POST /api/stages/[id]/publish or unpublish with the chosen audience.
 */
export function PublishDialog({
  open,
  stageId,
  onOpenChange,
  onPublishSuccess,
}: PublishDialogProps) {
  const { t } = useI18n();
  const [audience, setAudience] = useState<AudienceTier>(0);
  const [status, setStatus] = useState<'idle' | 'publishing' | 'unpublishing' | 'error'>('idle');
  const [unpublishError, setUnpublishError] = useState(false);

  const AUDIENCE_OPTIONS: { value: AudienceTier; label: string }[] = [
    { value: 0, label: t('publishing.audienceEveryone') },
    { value: 1, label: t('publishing.audienceGuests') },
    { value: 2, label: t('publishing.audienceLearners') },
  ];

  const handlePublish = async () => {
    setStatus('publishing');
    try {
      const res = await fetch(`/api/stages/${stageId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience }),
      });
      if (!res.ok) {
        setStatus('error');
      } else {
        onPublishSuccess?.();
      }
    } catch {
      setStatus('error');
    }
  };

  const handleUnpublish = async () => {
    setStatus('unpublishing');
    setUnpublishError(false);
    try {
      const res = await fetch(`/api/stages/${stageId}/unpublish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        setStatus('error');
        setUnpublishError(true);
      } else {
        onPublishSuccess?.();
      }
    } catch {
      setStatus('error');
      setUnpublishError(true);
    }
  };

  const isLoading = status === 'publishing' || status === 'unpublishing';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{t('publishing.title')}</DialogTitle>
          <DialogDescription>{t('publishing.audienceHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <fieldset>
            <legend className="text-sm font-medium text-muted-foreground mb-2">
              {t('publishing.audience')}
            </legend>
            <div className="space-y-2">
              {AUDIENCE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="audience"
                    value={opt.value}
                    checked={audience === opt.value}
                    onChange={() => setAudience(opt.value)}
                    className="size-4 accent-foreground"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          {status === 'error' ? (
            <span className="text-sm text-destructive">
              {unpublishError ? t('publishing.unpublishFailed') : t('publishing.publishFailed')}
            </span>
          ) : null}

          <Button
            variant="outline"
            onClick={() => {
              setStatus('idle');
              onOpenChange(false);
            }}
          >
            {t('common.cancel')}
          </Button>

          <Button disabled={isLoading} onClick={handlePublish}>
            {isLoading && status === 'publishing' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {t('publishing.publish')}
          </Button>

          <Button
            disabled={isLoading}
            onClick={() => {
              if (status !== 'unpublishing' && status !== 'publishing') {
                if (window.confirm(t('publishing.unpublishConfirm'))) {
                  handleUnpublish();
                }
              }
            }}
          >
            {isLoading && status === 'unpublishing' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {t('publishing.unpublish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
