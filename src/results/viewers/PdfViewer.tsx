import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react-native';
import { trackResultPreviewed } from '@/analytics/resultEvents';
import { formatBytes } from '@/lib/format';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';
import { useResultFile } from '../useResultFile';
import { LoadState } from './LoadState';
import { openPdf, sharePdf } from './openPdf';
import type { ViewerProps } from './types';

/** No in-app PDF render (TOOLS_V1 section 9): download, then hand the file to the system viewer. */
export function PdfViewer({ descriptor, context }: ViewerProps) {
  const { t } = useTranslation();
  const [wanted, setWanted] = useState(false);
  const [noApp, setNoApp] = useState(false);
  const { state, reload } = useResultFile(
    descriptor.jobId,
    descriptor.fileName,
    descriptor.sizeBytes,
    wanted,
  );
  const [launched, setLaunched] = useState(false);

  if (wanted && state.status === 'ready' && !launched) {
    setLaunched(true);
    void openPdf(state.file).then((outcome) => {
      if (outcome !== 'failed') trackResultPreviewed(context, 'pdf');
      if (outcome === 'no_app') setNoApp(true);
    });
  }

  return (
    <View className="items-start gap-3" testID="pdf-card">
      <FileText size={32} color={colors.mutedFg} />
      <Text className="font-semibold">{descriptor.fileName}</Text>
      {descriptor.sizeBytes !== undefined ? (
        <Num className="text-sm text-muted-fg">{formatBytes(descriptor.sizeBytes)}</Num>
      ) : null}
      <Text className="text-muted-fg">{t('result.pdfBody')}</Text>
      {wanted && state.status !== 'ready' ? <LoadState state={state} onRetry={reload} /> : null}
      {noApp && state.status === 'ready' ? (
        <>
          <Text className="text-danger">{t('result.noPdfApp')}</Text>
          <Button
            label={t('result.sharePdf')}
            variant="secondary"
            onPress={() => void sharePdf(state.file)}
          />
        </>
      ) : null}
      <Button
        label={t('result.openPdf')}
        onPress={() => {
          setNoApp(false);
          setLaunched(false);
          if (wanted && state.status === 'ready') return void openPdf(state.file);
          setWanted(true);
        }}
      />
    </View>
  );
}
